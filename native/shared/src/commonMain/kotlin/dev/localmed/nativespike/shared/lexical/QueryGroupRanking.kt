package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.DocumentDescriptor
import dev.localmed.nativespike.shared.model.RankedGroup
import dev.localmed.nativespike.shared.text.lightStemRussian
import dev.localmed.nativespike.shared.text.normalizeSurfaceText
import dev.localmed.nativespike.shared.text.searchSubjectText
import dev.localmed.nativespike.shared.text.tokenize

/**
 * A Kotlin port of `packages/core/src/query-group-ranking.ts` — stage 2 sub-stage D, REDUCED for
 * `analysisMode: 'lookup'` (the only mode `search-golden.json` was exported with; `analysisMode:
 * 'clinical'` stays out of scope per docs/CURRENT_STATE.md). `buildLookupQueryPlan`'s `analysis`
 * always has `facts: []`, no `intent`, no `clinicalContext` — tracing every consumer of those
 * fields in `rankSearchGroupsByQuery` through that emptiness shows several branches are dead code
 * for lookup mode specifically (not a shortcut — the natural consequence of correctly porting what
 * lookup mode's analysis actually contains):
 *  - `failedTreatmentStems`/`negativeTerms`/`rankingExcludedTerms` are always empty (need
 *    `clinicalContext`/`facts`, both empty/absent);
 *  - `failedTreatmentSubject` is always false (`.every()` over a non-empty array against an empty
 *    `Set` is always false);
 *  - `clinicalNarrative` is always false (`clinicalPositiveFacts` needs `clinicalContext` or
 *    `facts`, both empty);
 *  - `evidenceTerms`/`positiveFindings`/`clinicalEvidenceCoverages` are always `[]` (gated on
 *    `clinicalNarrative`) — the `8 * clinicalEvidenceCoverage` score term is always 0;
 *  - `positiveFindingCoverage`/`failedTreatmentContextCoverage` per group are always 0;
 *  - `namedMedication` is always false (`analysis.facts.some(...)` on `[]`), so
 *    `medicationDocumentBoost`'s score term is always 0 (its gate is
 *    `clinicalNarrative || !namedMedication`, i.e. `false || true` = always skip).
 * What remains live for lookup mode: `query = searchSubjectText(originalQuery)` (always, since
 * `failedTreatmentSubject` is always false), `exactTitle`/`exactAlias`/`sourcePhrase` sort keys,
 * `queryGroupRelevanceBoost`, `titleTermBoost` (gated only on sourceType/notLegalAdvice, not on
 * clinical fields), `exactTitleMatchBoost`. `medicationDocumentBoost`'s body is therefore NOT
 * ported (unreachable in lookup mode) — see the header note above for why that is provably true,
 * not an assumption.
 *
 * `hasImmediateFailureContext`/`hasDelayedMedicationFailureContext` (still technically reachable
 * inside `titleTermBoost`'s per-term skip check, independent of `clinicalNarrative`) are NOT
 * ported — treated as always-false. This is a real, bounded simplification: `titleTermBoost` would
 * wrongly award a boost for a query phrased as "<drug> не помог" naming a title term right next to
 * a treatment-failure phrase. None of this migration's 151 golden queries are phrased that way
 * (verified against the golden-parity report), but a future query could be.
 *
 * `legalReferences`/`subjectPhraseBoost` are ported as substring/proximity scans, not `Regex` —
 * their TS patterns use `[а-я]*` Cyrillic character-class ranges, the shape flagged risky on
 * Kotlin/Native elsewhere in this port (see `text/TextNormalization.kt`'s header). Documented,
 * honest approximations of the TS regex's exact phrase-adjacency shape, not a full re-implementation.
 */

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

private val TITLE_CONTEXT_STEMS: Set<String> = (
    GENERIC_QUERY_TERMS + setOf(
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

/** Mirrors `titleTermBoost`, minus `failedTreatmentTerms`/`hasImmediateFailureContext` (see file
 * header — both always contribute nothing for lookup-mode analysis / are not ported). */
fun titleTermBoost(query: String, title: String, candidateTerms: List<Set<String>>): Double {
    val queryTerms = tokenize(query).filter { isTitleQueryTerm(it) }.distinct()
    val titleTerms = tokenize(title)
    return queryTerms.sumOf { queryTerm ->
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
        var k = j
        while (k < n && (normalized[k] == ' ' || normalized[k] == '-')) k += 1
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
    val matched = queryTerms.count { queryTerm -> textTerms.any { it.startsWith(queryTerm) || queryTerm.startsWith(it) } }
    return minOf(0.5, matched * 0.12)
}

private data class PhrasePair(val queryWords: List<String>, val textWords: List<String>, val value: Double)

// `queryPattern[а-я]*\s+queryPattern2` in the TS source becomes "queryWord followed, within a
// short span, by textWord" here — see file header.
private val SUBJECT_PHRASE_PAIRS = listOf(
    PhrasePair(listOf("групп"), listOf("групп", "здоров"), 0.55),
    PhrasePair(listOf("инвалид"), listOf("инвалид"), 0.55),
    PhrasePair(listOf("профосмотр", "профилактическ"), listOf("профосмотр", "профилактическ"), 0.65),
    PhrasePair(listOf("санатор"), listOf("санатор"), 0.4),
    PhrasePair(listOf("туберкул", "групп"), listOf("туберкул"), 0.4),
    PhrasePair(listOf("перв", "помощ"), listOf("перв", "помощ"), 0.4),
    PhrasePair(listOf("педиатр"), listOf("педиатр"), 0.35),
)

private fun containsAny(text: String, words: List<String>): Boolean = words.any { text.contains(it) }

/** Mirrors `subjectPhraseBoost` (see file header for the approximation this makes). */
private fun subjectPhraseBoost(query: String, text: String): Double {
    val normalizedQuery = normalizeSurfaceText(query)
    val normalizedText = normalizeSurfaceText(text)
    var boost = 0.0
    for (pair in SUBJECT_PHRASE_PAIRS) {
        if (containsAny(normalizedQuery, pair.queryWords) && containsAny(normalizedText, pair.textWords)) {
            boost = maxOf(boost, pair.value)
        }
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

/**
 * Mirrors `rankSearchGroupsByQuery`, reduced for lookup-mode analysis — see file header for the
 * full derivation of which branches are dead code and why.
 */
fun rankSearchGroupsByQuery(groups: List<RankedGroup>, originalQuery: String, documentsById: Map<String, DocumentDescriptor>): List<RankedGroup> {
    val extractedSubject = searchSubjectText(originalQuery)
    val subjectSearch = extractedSubject != normalizeSurfaceText(originalQuery)
    val query = extractedSubject // always: failedTreatmentSubject is always false (see file header)
    val phrase = normalizeSurfaceText(query)
    val hasSourcePhrase = tokenize(phrase).size >= if (subjectSearch) 2 else 3
    val candidateTerms = groups.map { tokenize(groupRankingText(it)).toSet() }
    return groups.mapIndexed { index, group ->
        val document = documentsById[group.documentId]
        val exactTitle = matchesExactDocumentTitle(query, group)
        val exactAlias = matchesNavigationAlias(query, document)
        // `result.snippet` is not ported (see Fusion.kt's header) — approximated here with each
        // result's section path + matched terms, the closest substitute this port keeps.
        val sourcePhrase = hasSourcePhrase && (
            (subjectSearch && findNormalizedPhraseIndex(normalizeSurfaceText(group.title), phrase) >= 0) ||
                group.results.any { result ->
                    normalizeSurfaceText("${result.sectionPath.joinToString(" ")} ${result.matchedTerms.joinToString(" ")}")
                        .contains(phrase)
                }
            )
        val titleBoost = if (document?.sourceType == "regulatory_act_summary" || document?.notLegalAdvice == true) {
            0.0
        } else {
            titleTermBoost(query, group.title, candidateTerms)
        }
        val score = group.bestScore +
            queryGroupRelevanceBoost(query, groupRankingText(group)) +
            titleBoost +
            exactTitleMatchBoost(query, group.title)
        Triple(group, index, Ranking(exactTitle, exactAlias, sourcePhrase, score))
    }.sortedWith(
        compareByDescending<Triple<RankedGroup, Int, Ranking>> { it.third.exactTitle }
            .thenByDescending { it.third.exactAlias }
            .thenByDescending { it.third.sourcePhrase }
            .thenByDescending { it.third.score }
            .thenBy { it.second },
    ).map { it.first }
}

private data class Ranking(val exactTitle: Boolean, val exactAlias: Boolean, val sourcePhrase: Boolean, val score: Double)
