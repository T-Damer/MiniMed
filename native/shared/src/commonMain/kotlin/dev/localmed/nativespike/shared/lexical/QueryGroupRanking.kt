package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.DocumentDescriptor
import dev.localmed.nativespike.shared.model.RankedGroup
import dev.localmed.nativespike.shared.model.QueryAnalysis
import dev.localmed.nativespike.shared.model.QueryFactKind
import dev.localmed.nativespike.shared.model.QueryFactPolarity
import dev.localmed.nativespike.shared.model.SearchIntentKind
import dev.localmed.nativespike.shared.text.lightStemRussian
import dev.localmed.nativespike.shared.text.normalizeSurfaceText
import dev.localmed.nativespike.shared.text.searchSubjectText
import dev.localmed.nativespike.shared.text.tokenize

/** Source-backed lookup and clinical group ranking mirror core/query-group-ranking.ts.
 * Clinical facts affect candidate ordering only; source text and passage scores are retained. */

private fun stemToken(token: String): String = lightStemRussian(token)

private val GENERIC_QUERY_TERMS = setOf(
    "какой", "какая", "какие", "который", "пациент", "ребенок", "ребёнок", "взрослый", "нужно",
    "можно", "приказ", "закон",
)

private val TITLE_FORM_STEMS = setOf(
    "таблетк", "порошк", "раствор", "капсул", "сироп", "суппозитор", "маз", "гел", "крем", "капл",
    "спре", "инъекц", "приготовлен", "прием", "внутрь", "назальн", "наружн", "глазн", "ректальн",
    "лиофилизат", "суспенз", "гранул", "пастил", "шипуч", "пленк", "покрыт", "оболочк", "действующ",
    "веществ", "доз", "внутримышечн", "внутривенн", "мг", "мл", "шт",
)

private val PATIENT_CONTEXT_STEMS = setOf(
    "ребенок", "ребенк", "дети", "детский", "взрослый", "мужчина", "женщина", "мужской", "женский",
).map(::stemToken).toSet()

private val CHILD_POPULATION_STEMS = setOf("ребенок", "ребенк", "дети", "детей", "детям", "детьми", "детях", "детский").map(::stemToken).toSet()
private val ADULT_POPULATION_STEMS = setOf("взрослый", "взрослых", "взрослым", "взрослыми", "взрослые").map(::stemToken).toSet()

private fun explicitAgePopulation(text: String): String? {
    val stems = tokenize(text).map(::stemToken)
    val child = stems.any { it in CHILD_POPULATION_STEMS }
    val adult = stems.any { it in ADULT_POPULATION_STEMS }
    return if (child == adult) null else if (child) "child" else "adult"
}

private val TITLE_CONTEXT_STEMS: Set<String> = (
    GENERIC_QUERY_TERMS + PATIENT_CONTEXT_STEMS + setOf(
        "детский", "ребенк", "вес", "год", "лет", "первый", "второй", "третий", "заболевание",
        "инфекция", "мочевой", "мочевых", "путь", "путей",
    )
    ).map { stemToken(it) }.toSet()

/** Mirrors `tokensMatch`. */
private fun tokensMatch(queryToken: String, titleToken: String): Boolean {
    if (
        titleToken == queryToken ||
        (minOf(titleToken.length, queryToken.length) >= 5 &&
            (titleToken.startsWith(queryToken) || queryToken.startsWith(titleToken)))
    ) {
        return true
    }
    val queryStem = stemToken(queryToken)
    val titleStem = stemToken(titleToken)
    return titleStem == queryStem ||
        (minOf(titleStem.length, queryStem.length) >= 5 &&
            (titleStem.startsWith(queryStem) || queryStem.startsWith(titleStem)))
}

/** Mirrors `isFormOrStrengthToken`. */
private fun isFormOrStrengthToken(token: String): Boolean {
    if (token.isNotEmpty() && token[0] in '0'..'9') return true
    if (token.length <= 2) return true
    val stem = stemToken(token)
    if (stem in TITLE_FORM_STEMS) return true
    return TITLE_FORM_STEMS.any { formStem -> stem.startsWith(formStem) || formStem.startsWith(stem) }
}

/** Mirrors `isTitleQueryTerm`. */
private fun isTitleQueryTerm(term: String): Boolean = term.length >= 3 && stemToken(term) !in TITLE_CONTEXT_STEMS

/** Mirrors `isCombinationTitle`. */
private fun isCombinationTitle(title: String, leftoverTerms: List<String>): Boolean {
    if (title.contains('+') || title.contains('/') || title.contains(" и ") || title.contains(" с ")) return true
    return leftoverTerms.any { !isFormOrStrengthToken(it) }
}

/** Mirrors `exactTitleMatchBoost`. */
fun exactTitleMatchBoost(query: String, title: String): Double {
    val normalizedQuery = normalizeSurfaceText(query).trim()
    if (normalizedQuery.isEmpty()) return 0.0
    val normalizedTitle = normalizeSurfaceText(title).trim()
    if (normalizedTitle == normalizedQuery) return 6.0

    val queryTerms = tokenize(normalizedQuery).filter { !isFormOrStrengthToken(it) && isTitleQueryTerm(it) }
    if (queryTerms.isEmpty()) return 0.0
    val titleTerms = tokenize(normalizedTitle)
    if (titleTerms.isEmpty()) return 0.0

    val matchedTitleIndexes = queryTerms.map { queryTerm -> titleTerms.indexOfFirst { tokensMatch(queryTerm, it) } }
    if (matchedTitleIndexes.any { it < 0 }) return 0.0

    val leftoverTerms = titleTerms.filterIndexed { index, titleTerm ->
        index !in matchedTitleIndexes && queryTerms.none { tokensMatch(it, titleTerm) }
    }
    val combination = isCombinationTitle(normalizedTitle, leftoverTerms)
    val headedByQuery = matchedTitleIndexes.firstOrNull() == 0
    if (combination) return if (headedByQuery) 1.2 else 0.8
    if (normalizedTitle.startsWith(normalizedQuery)) return 5.0
    if (headedByQuery && leftoverTerms.all { isFormOrStrengthToken(it) }) return 5.0
    return if (headedByQuery) 4.5 else 3.5
}

/** Mirrors titleTermBoost, excluding a named unsuccessful treatment from positive evidence. */
fun titleTermBoost(query: String, title: String, candidateTerms: List<Set<String>>, failedTreatmentTerms: Set<String> = emptySet()): Double {
    val queryTerms = tokenize(query).filter { isTitleQueryTerm(it) }.distinct()
    val titleTerms = tokenize(title)
    return queryTerms.sumOf { queryTerm ->
        if (stemToken(queryTerm) in failedTreatmentTerms || hasImmediateFailureContext(query, queryTerm)) return@sumOf 0.0
        val titleIndex = titleTerms.indexOfFirst { !isFormOrStrengthToken(it) && tokensMatch(queryTerm, it) }
        if (titleIndex < 0) return@sumOf 0.0
        val documentFrequency = candidateTerms.count { terms -> terms.any { !isFormOrStrengthToken(it) && tokensMatch(queryTerm, it) } }
        val inverseFrequency = kotlin.math.ln((candidateTerms.size + 1).toDouble() / (documentFrequency + 1))
        val specificity = minOf(1.0, queryTerm.length * 0.08)
        val headedTitleBoost = if (titleIndex == 0) 0.45 else 0.0
        1.8 + specificity + headedTitleBoost + inverseFrequency * 0.2
    }
}

private fun compactReference(value: String): String =
    normalizeSurfaceText(value).filter { it in '0'..'9' || it in 'a'..'z' || it in 'а'..'я' }

private fun isRefBoundaryChar(c: Char?): Boolean =
    c == null || !(c in '0'..'9' || c in 'a'..'z' || c in 'а'..'я')

/** Mirrors `legalReferences`: a 2-4 digit group, then optional spaces/dash, then "фз" or "н",
 * boundary-delimited on both sides. See file header for the Regex-avoidance rationale. */
private fun legalReferences(value: String): Set<String> {
    val normalized = normalizeSurfaceText(value)
    val refs = LinkedHashSet<String>()
    val n = normalized.length
    var i = 0
    while (i < n) {
        if (normalized[i] !in '0'..'9' || !isRefBoundaryChar(normalized.getOrNull(i - 1))) {
            i += 1
            continue
        }
        var j = i
        while (j < n && normalized[j] in '0'..'9') j += 1
        val digitLength = j - i
        if (digitLength !in 2..4) {
            i = j
            continue
        }
        // Mirrors `\s*[-–—]?\s*` exactly: 0+ spaces, then at most ONE dash (already unified to
        // plain '-' by normalizeSurfaceText), then 0+ spaces again — not a loop over both chars.
        var k = j
        while (k < n && normalized[k] == ' ') k += 1
        if (k < n && normalized[k] == '-') k += 1
        while (k < n && normalized[k] == ' ') k += 1
        val word = when {
            normalized.startsWith("фз", k) -> "фз"
            normalized.startsWith("н", k) -> "н"
            else -> null
        }
        if (word != null) {
            val end = k + word.length
            if (isRefBoundaryChar(normalized.getOrNull(end))) {
                refs.add(compactReference(normalized.substring(i, end)))
                i = end
                continue
            }
        }
        i = j
    }
    return refs
}

/** Mirrors `textCoverage`. */
private fun textCoverage(query: String, text: String): Double {
    val queryTerms = tokenize(query).filter { it.length >= 4 && it !in GENERIC_QUERY_TERMS }.toSet()
    val textTerms = tokenize(text)
    val matchedTextTerms = queryTerms.mapNotNull { queryTerm ->
        textTerms.firstOrNull { it.startsWith(queryTerm) || queryTerm.startsWith(it) }
    }.toSet()
    return minOf(0.5, matchedTextTerms.size * 0.12)
}

private fun containsAny(text: String, words: List<String>): Boolean = words.any { text.contains(it) }

/** Mirrors `[а-я]*\s+` right after `prefix` in the TS regexes below: 0+ Cyrillic letters, then
 * 1+ whitespace (mandatory) — returns the index just past the whitespace run, or null if `prefix`
 * isn't found or isn't followed by that shape anywhere. Tries every occurrence of `prefix`, like a
 * global regex search would. */
private fun findWordGapEnd(text: String, prefix: String, from: Int = 0): Pair<Int, Int>? {
    var index = text.indexOf(prefix, from)
    while (index >= 0) {
        var i = index + prefix.length
        while (i < text.length && text[i] in 'а'..'я') i += 1
        val gapStart = i
        while (i < text.length && text[i].isWhitespace()) i += 1
        if (i > gapStart) return index to i
        index = text.indexOf(prefix, index + 1)
    }
    return null
}

/** Mirrors `prefix[а-я]*\s+suffix` (e.g. `групп[а-я]*\s+здоров`, `перв[а-я]*\s+помощ`): `prefix`,
 * then the shape `findWordGapEnd` matches, then `suffix` starting exactly there. */
private fun matchesWordGapPhrase(text: String, prefix: String, suffix: String): Boolean {
    var from = 0
    while (true) {
        val gap = findWordGapEnd(text, prefix, from) ?: return false
        if (text.startsWith(suffix, gap.second)) return true
        from = gap.first + 1
    }
}

/** Mirrors `профосмотр|профилактическ[а-я]*\s+(?:медицинск[а-я]*\s+)?осмотр`. */
private fun matchesProfilacticExamPhrase(text: String): Boolean {
    if (text.contains("профосмотр")) return true
    var from = 0
    while (true) {
        val gap = findWordGapEnd(text, "профилактическ", from) ?: return false
        if (text.startsWith("осмотр", gap.second)) return true
        val medGap = findWordGapEnd(text, "медицинск", gap.second)
        // The optional "медицинск[а-я]*\s+" group must start exactly where the first gap ended —
        // not just appear somewhere later in the text.
        if (medGap != null && medGap.first == gap.second && text.startsWith("осмотр", medGap.second)) {
            return true
        }
        from = gap.first + 1
    }
}

/** Mirrors `туберкул[а-я]*.*групп|групп[а-я]*.*туберкул` (query side): with an unbounded `.*` gap
 * and no other constraint, this reduces to "both words present, in either order" — i.e. both
 * present at all, order irrelevant. Kept as a named function (not a bare `containsAny`) so the
 * TS-regex provenance and this exact equivalence stays documented at the call site. */
private fun matchesTuberculosisGroupPhrase(text: String): Boolean =
    text.contains("туберкул") && text.contains("групп")

/**
 * Mirrors `subjectPhraseBoost` with exact phrase-adjacency matching (not a `contains`
 * approximation) — manual scanners equivalent to the TS regexes' `[а-я]*\s+` shape, for the same
 * Kotlin/Native Cyrillic-character-class-range caution as elsewhere in this port.
 */
private fun subjectPhraseBoost(query: String, text: String): Double {
    val normalizedQuery = normalizeSurfaceText(query)
    val normalizedText = normalizeSurfaceText(text)
    var boost = 0.0
    if (matchesWordGapPhrase(normalizedQuery, "групп", "здоров") && matchesWordGapPhrase(normalizedText, "групп", "здоров")) {
        boost = maxOf(boost, 0.55)
    }
    if (normalizedQuery.contains("инвалид") && normalizedText.contains("инвалид")) {
        boost = maxOf(boost, 0.55)
    }
    if (matchesProfilacticExamPhrase(normalizedQuery) && matchesProfilacticExamPhrase(normalizedText)) {
        boost = maxOf(boost, 0.65)
    }
    if (normalizedQuery.contains("санатор") && normalizedText.contains("санатор")) {
        boost = maxOf(boost, 0.4)
    }
    if (matchesTuberculosisGroupPhrase(normalizedQuery) && normalizedText.contains("туберкул")) {
        boost = maxOf(boost, 0.4)
    }
    if (matchesWordGapPhrase(normalizedQuery, "перв", "помощ") && matchesWordGapPhrase(normalizedText, "перв", "помощ")) {
        boost = maxOf(boost, 0.4)
    }
    if (normalizedQuery.contains("педиатр") && normalizedText.contains("педиатр")) {
        boost = maxOf(boost, 0.35)
    }
    return boost
}

private val CURRENT_EDITION_WORDS =
    listOf("действующ", "актуальн", "текущ", "сейчас", "на сегодня", "вместо", "заменил", "заменяет", "заменен", "заменён", "заменить")
private val HISTORICAL_EDITION_WORDS = listOf("утратил сил", "утратила сил", "историческ", "старый", "старая", "старое", "отменён", "отменен", "недействующ")
private val HISTORICAL_DOCUMENT_WORDS = listOf("утратил сил", "утратила сил", "историческ", "отменён", "отменен", "недействующ")

/** Mirrors `editionStatusBoost`. */
private fun editionStatusBoost(query: String, text: String): Double {
    val normalizedQuery = normalizeSurfaceText(query)
    val normalizedText = normalizeSurfaceText(text)
    val historicalDocument = containsAny(normalizedText, HISTORICAL_DOCUMENT_WORDS)
    if (containsAny(normalizedQuery, CURRENT_EDITION_WORDS) && historicalDocument) return -2.0
    if (containsAny(normalizedQuery, HISTORICAL_EDITION_WORDS) && historicalDocument) return 0.8
    return 0.0
}

/** Mirrors `queryGroupRelevanceBoost`. */
fun queryGroupRelevanceBoost(query: String, text: String): Double {
    val queryReferences = legalReferences(query)
    val textReferences = legalReferences(text)
    val referenceBoost = if (queryReferences.any { it in textReferences }) 1.0 else 0.0
    return referenceBoost + textCoverage(query, text) + subjectPhraseBoost(query, text) + editionStatusBoost(query, text)
}

/** Mirrors `matchesExactDocumentTitle`. */
private fun matchesExactDocumentTitle(query: String, group: RankedGroup): Boolean {
    val subject = normalizeSurfaceText(searchSubjectText(query)).trim()
    if (subject.isEmpty()) return false
    return normalizeSurfaceText(group.title).trim() == subject ||
        group.results.any { normalizeSurfaceText(it.documentTitle).trim() == subject }
}

/** Mirrors `matchesNavigationAlias`. */
fun matchesNavigationAlias(query: String, document: DocumentDescriptor?): Boolean {
    val subject = searchSubjectText(query)
    return document?.navigationAliases?.any { normalizeSurfaceText(it) == subject } == true
}

private fun groupRankingText(group: RankedGroup): String =
    (listOf(group.title) + group.results.flatMap { listOf(it.sectionPath.joinToString(" "), it.matchedTerms.joinToString(" ")) })
        .joinToString(" ")

// The four module families `catalog_module_builder.py` generates lightweight core pointers for.
private val CATALOG_POINTER_TARGET_FAMILIES = setOf("reference", "clinical", "medication", "legal")

private fun resolvedGroupIdentity(documentId: String, documentsById: Map<String, DocumentDescriptor>): String {
    val document = documentsById[documentId] ?: return documentId
    if (document.sourceType != "core_catalog_pointer") return documentId
    val family = document.catalogFamily
    if (family == null || family !in CATALOG_POINTER_TARGET_FAMILIES) return documentId
    val target = document.targetDocumentId
    return if (!target.isNullOrBlank()) target else documentId
}

/** Mirrors `collapseGroupsByTargetDocument`. */
fun collapseGroupsByTargetDocument(groups: List<RankedGroup>, documentsById: Map<String, DocumentDescriptor>): List<RankedGroup> {
    val seen = LinkedHashSet<String>()
    return groups.filter { group ->
        val identity = resolvedGroupIdentity(group.documentId, documentsById)
        if (identity in seen) false else { seen.add(identity); true }
    }
}

private val DIRECT_FAILURE_AFTER = clinicalRegex("""^\s*(?:не\s+(?:помог\p{L}*|сработ\p{L}*|подейств\p{L}*|перенос\p{L}*)|неэффектив\p{L}*)""")
private val DIRECT_FAILURE_BEFORE = listOf(
    clinicalRegex("""(?:нет|без|отсутств\p{L}*)\s+(?:клиническ\p{L}*\s+)?(?:эффект\p{L}*|улучшен\p{L}*|ответ\p{L}*)\s+(?:от|на|после)\s*$"""),
    clinicalRegex("""(?:эффект\p{L}*|улучшен\p{L}*|ответ\p{L}*)\s+(?:нет|отсутств\p{L}*)\s+(?:от|на|после)\s*$"""),
)
private val DELAYED_FAILURE = listOf(
    clinicalRegex("""(?:эффект\p{L}*|улучшен\p{L}*|ответ\p{L}*)\s+(?:нет|отсутств\p{L}*|не\s+наблюда\p{L}*)"""),
    clinicalRegex("""(?:ухудш\p{L}*|без\s+улучшен\p{L}*|неэффектив\p{L}*)"""),
)
internal fun hasImmediateFailureContext(query: String, term: String): Boolean {
    val text=normalizeSurfaceText(query);val normalized=normalizeSurfaceText(term)
    if(normalized.isEmpty()) return false
    var from=0
    while(from<text.length) {
        val index=text.indexOf(normalized,from);if(index<0) return false
        val before=text.substring(maxOf(0,index-72),index)
        val end=index+normalized.length;val after=text.substring(end,minOf(text.length,end+72))
        if(DIRECT_FAILURE_AFTER.containsMatchIn(after) || DIRECT_FAILURE_BEFORE.any { it.containsMatchIn(before) }) return true
        from=end
    }
    return false
}
private fun hasDelayedMedicationFailureContext(query: String, medication: String): Boolean {
    if(hasImmediateFailureContext(query,medication)) return true
    val text=normalizeSurfaceText(query);val normalized=normalizeSurfaceText(medication)
    if(normalized.isEmpty()) return false
    var from=0
    while(from<text.length) {
        val index=text.indexOf(normalized,from);if(index<0) return false
        val end=index+normalized.length;val after=text.substring(end,minOf(text.length,end+112))
        if(DELAYED_FAILURE.any { it.containsMatchIn(after) }) return true
        from=end
    }
    return false
}
private fun failedTreatmentStems(query: String, analysis: QueryAnalysis?): Set<String> =
    analysis?.clinicalContext?.currentMedicines.orEmpty().filter {
        hasDelayedMedicationFailureContext(query,it.value) || hasDelayedMedicationFailureContext(query,it.normalizedValue)
    }.flatMap { tokenize("${it.value} ${it.normalizedValue}").map(::stemToken) }.toSet()

internal fun coverageTier(coverage: Double): Int = when { coverage<=0 -> 0;coverage>=1 -> 3;coverage>=0.5 -> 2;else -> 1 }
private fun failedTreatmentContextCoverage(failed: Set<String>, group: RankedGroup, document: DocumentDescriptor?): Double {
    if(failed.isEmpty() || document?.sourceType !in setOf("clinical_recommendation","clinical_recommendation_summary")) return 0.0
    val words=tokenize((listOf(group.title)+group.results.map { it.snippet }).joinToString(" ")).map(::stemToken)
    if(words.isEmpty()) return 0.0
    return failed.count { term -> words.any { tokensMatch(term,it) } }.toDouble()/failed.size
}
private val INSTRUCTION_QUERY=clinicalRegex("""(?:инструкц|показани|противопоказани|побочн|способ[а-я]*\s+применени|дозировк|как\s+(?:принимать|применять|вводить))""")
private val REGISTRY_QUERY=clinicalRegex("""(?:грлс|регистрационн[а-я]*\s+(?:номер|карточк|запис)|регистрац[а-я]*\s+препарат)""")
private fun medicationDocumentBoost(query: String, document: DocumentDescriptor?, title: String): Double {
    if(document==null) return 0.0
    val normalized=normalizeSurfaceText(query);val titleTerms=tokenize(title).map(::stemToken).toSet()
    if(tokenize(normalized).none { isTitleQueryTerm(it) && !isFormOrStrengthToken(it) && stemToken(it) in titleTerms }) return 0.0
    val instruction=INSTRUCTION_QUERY.containsMatchIn(normalized);val registry=REGISTRY_QUERY.containsMatchIn(normalized)
    return when(document.sourceType) {
        "official_drug_instruction" -> if(instruction) 8.0 else 0.0
        "official_registry_summary" -> if(registry) 8.0 else 0.0
        "core_catalog_pointer" -> if(document.catalogFamily=="medication" && !instruction && !registry) 8.0 else 0.0
        else -> 0.0
    }
}

/** Same bounded candidate ordering as TS, with lookup facts absent and clinical facts explicit. */
fun rankSearchGroupsByQuery(groups: List<RankedGroup>, originalQuery: String, documentsById: Map<String, DocumentDescriptor>, analysis: QueryAnalysis? = null): List<RankedGroup> {
    val failedTreatmentTerms=failedTreatmentStems(originalQuery,analysis)
    val extractedSubject=searchSubjectText(originalQuery)
    val subjectStems=tokenize(extractedSubject).map(::stemToken)
    val failedTreatmentSubject=subjectStems.isNotEmpty() && subjectStems.all { it in failedTreatmentTerms }
    val subjectSearch=!failedTreatmentSubject && extractedSubject!=normalizeSurfaceText(originalQuery)
    val query=if(failedTreatmentSubject) normalizeSurfaceText(originalQuery) else extractedSubject
    val namedMedication=analysis?.facts?.any { it.kind==QueryFactKind.MEDICATION && it.polarity==QueryFactPolarity.POSITIVE } == true
    val weightRanges=analysis?.clinicalContext?.weight.orEmpty().map { it.range }
    val positiveFacts=analysis?.clinicalContext?.positiveFindings.orEmpty().filter { it.range !in weightRanges }
    val clinicalNarrative=analysis?.intent?.primary!=SearchIntentKind.MEDICATION && positiveFacts.isNotEmpty()
    val negativeTerms=analysis?.facts.orEmpty().filter { it.polarity==QueryFactPolarity.NEGATIVE }.flatMap { tokenize(it.normalizedValue).map(::stemToken) }.toSet()
    val excluded=negativeTerms+if(clinicalNarrative) failedTreatmentTerms else emptySet()
    val positiveQuery=if(excluded.isNotEmpty()) tokenize(query).filter { stemToken(it) !in excluded }.joinToString(" ") else query
    val evidenceTerms=if(clinicalNarrative) tokenize(query).filter {
        isTitleQueryTerm(it) && it !in GENERIC_QUERY_TERMS && stemToken(it) !in negativeTerms && stemToken(it) !in failedTreatmentTerms
    }.distinct() else emptyList()
    val positiveFindings=if(clinicalNarrative) positiveFacts.map { fact ->
        val variants=mutableListOf(tokenize(fact.value),tokenize(fact.normalizedValue))
        if(fact.kind in setOf(QueryFactKind.MEASUREMENT,QueryFactKind.TEMPERATURE)) variants.add(tokenize(fact.label))
        variants.filter { it.isNotEmpty() }
    }.filter { it.isNotEmpty() } else emptyList()
    val phrase=normalizeSurfaceText(query)
    val hasSourcePhrase=tokenize(phrase).size>=if(subjectSearch) 2 else 3
    val candidateTerms=groups.map { tokenize(groupRankingText(it)).toSet() }
    val queryPopulation=if(analysis==null) explicitAgePopulation(originalQuery) else null
    val subjectTerms=if(clinicalNarrative || failedTreatmentTerms.isNotEmpty() ||
        (queryPopulation==null && tokenize(positiveQuery).none { stemToken(it) in PATIENT_CONTEXT_STEMS })) emptyList() else
        tokenize(positiveQuery).filter { isTitleQueryTerm(it) && !isFormOrStrengthToken(it) &&
            (queryPopulation==null || (stemToken(it) !in CHILD_POPULATION_STEMS && stemToken(it) !in ADULT_POPULATION_STEMS)) }
    return groups.mapIndexed { index,group ->
        val document=documentsById[group.documentId]
        val words=tokenize((listOf(group.title)+group.results.map { it.snippet }).joinToString(" "))
        val subjectMatch=subjectTerms.isNotEmpty() && words.any { word -> subjectTerms.any { tokensMatch(it,word) } }
        val sourcePopulation=if(queryPopulation==null) null else explicitAgePopulation(group.title)
        val populationRank=if(queryPopulation==null || !subjectMatch) 0 else if(sourcePopulation!=null && sourcePopulation!=queryPopulation) 1 else 2
        val findingCoverage=if(positiveFindings.isEmpty()) 0.0 else positiveFindings.count { variants -> variants.any { terms -> terms.all { term -> words.any { tokensMatch(term,it) } } } }.toDouble()/positiveFindings.size
        val evidenceCoverage=if(evidenceTerms.size<3) 0.0 else group.results.maxOfOrNull { result ->
            val snippetWords=tokenize(result.snippet)
            evidenceTerms.count { term -> snippetWords.any { tokensMatch(term,it) } }.toDouble()/evidenceTerms.size
        } ?: 0.0
        val sourcePhrase=hasSourcePhrase && ((subjectSearch && findNormalizedPhraseIndex(normalizeSurfaceText(group.title),phrase)>=0) || group.results.any { normalizeSurfaceText(it.snippet).contains(phrase) })
        val titleBoost=if(document?.sourceType=="regulatory_act_summary" || document?.notLegalAdvice==true) 0.0 else titleTermBoost(positiveQuery,group.title,candidateTerms,failedTreatmentTerms)
        val score=group.bestScore+8*evidenceCoverage+queryGroupRelevanceBoost(positiveQuery,groupRankingText(group))+titleBoost+
            exactTitleMatchBoost(positiveQuery,group.title)+if(clinicalNarrative || !namedMedication) 0.0 else medicationDocumentBoost(query,document,group.title)
        Triple(group,index,Ranking(matchesExactDocumentTitle(query,group),matchesNavigationAlias(query,document),populationRank,sourcePhrase,subjectMatch,
            coverageTier(findingCoverage),coverageTier(failedTreatmentContextCoverage(failedTreatmentTerms,group,document)),coverageTier(evidenceCoverage),score))
    }.sortedWith(compareByDescending<Triple<RankedGroup,Int,Ranking>> { it.third.exactTitle }
        .thenByDescending { it.third.exactAlias }.thenByDescending { it.third.populationRank }
        .thenByDescending { it.third.sourcePhrase }.thenByDescending { it.third.subjectMatch }
        .thenByDescending { it.third.findingTier }.thenByDescending { it.third.failedTreatmentTier }.thenByDescending { it.third.evidenceTier }
        .thenByDescending { it.third.score }.thenBy { it.second }).map { it.first }
}
private data class Ranking(val exactTitle: Boolean,val exactAlias: Boolean,val populationRank: Int,val sourcePhrase: Boolean,val subjectMatch: Boolean,
    val findingTier: Int,val failedTreatmentTier: Int,val evidenceTier: Int,val score: Double)
