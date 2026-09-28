package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.DocumentDescriptor
import dev.localmed.nativespike.shared.model.RankedGroup
import dev.localmed.nativespike.shared.text.lightStemRussian
import dev.localmed.nativespike.shared.text.normalizeSurfaceText
import dev.localmed.nativespike.shared.text.searchSubjectText
import dev.localmed.nativespike.shared.text.tokenize

/**
 * A Kotlin port of the `apps/app/src/features/search/ScopedMedicalCore.ts` layer that runs AFTER
 * `packages/core`'s own `groups` — stage 2 sub-stage D of the migration (docs/CURRENT_STATE.md).
 * `export-search-golden.ts` calls `ScopedMedicalCore` (scope `'all'`), not `MedicalCore` directly,
 * so this layer's re-sorting and `documentKind`/`contentKind` tagging IS part of what golden's
 * `groups` field reflects — found while tracing where `documentKind`/`contentKind` actually get set
 * (they are not `packages/core` fields at all).
 *
 * Scope `'all'` has no entry in `SOURCE_TYPES_BY_SCOPE`, so `ScopedMedicalCore.search()`'s
 * document-id filtering, `keepExplicitMedicationMatches` (scope `'medications'`-only), and
 * `rankDiagnosisGroups` (scope `'diagnosis'`-only) never run for this export — not ported, they are
 * provably unreachable for `scope: 'all'`, read directly off the TS source's own branching.
 *
 * `filterMedicationDocuments`: for lookup-mode analysis (`facts: []`, no `intent`), `excludeByIntent`
 * is always `true` and `requireSameResult` is always `false` (same "always-empty analysis" argument
 * as `QueryGroupRanking.kt`'s header) — so only the "drop a medication-kind group whose title does
 * not name a query term" branch is reachable; that is what `filterMedicationDocuments` below ports,
 * not the full function (`medicationContextMatchScore`/`containsStructuredMedicationFact`/etc. are
 * all inside the unreachable `requireSameResult` branch).
 */

/** Mirrors `searchResultDocumentKind`. */
fun searchResultDocumentKind(document: DocumentDescriptor): String {
    if (document.interactiveAssessmentId != null) return "assessment"
    if (document.calculationRequired || document.interactiveCalculatorId != null) return "calculator"
    if (document.sourceType == "core_catalog_pointer") {
        return when {
            document.catalogFamily == "medication" -> "medication"
            document.catalogFamily == "legal" -> "legal"
            document.catalogFamily == "clinical" && document.entityType == "disease" -> "clinical-recommendation"
            else -> "reference"
        }
    }
    if (document.sourceType in setOf("allmed_reference", "official_drug_instruction", "official_registry_summary")) return "medication"
    if (document.sourceType.startsWith("clinical_recommendation")) return "clinical-recommendation"
    if (document.sourceType.startsWith("regulatory_act")) return "legal"
    return "reference"
}

/** Mirrors the inline `contentKind` computation in `ScopedMedicalCore.search()`. */
fun searchResultContentKind(document: DocumentDescriptor?): String = when {
    document?.contentMode == "module-pointer" -> "pointer"
    document?.sourceType?.endsWith("_summary") == true -> "summary"
    else -> "full-text"
}

private val CHILD_AUDIENCE_WORDS = listOf(
    "ребен", "ребён", "детск", "дети", "детей", "детям", "детьми", "детях", "младен", "груднич",
    "новорож", "несовершеннолет", "подрост", "школьник", "мальчик", "девочк", "педиатр",
)
private val ADULT_AUDIENCE_WORDS = listOf("взросл", "совершеннолет", "мужчин", "женщин", "терапевт")
private val AUDIENCE_TERM_PREFIXES = listOf(
    "ребен", "ребён", "дет", "детск", "младен", "груднич", "новорож", "несовершеннолет", "подрост",
    "школьник", "мальчик", "девочк", "взросл", "совершеннолет", "мужчин", "женщин",
)

private fun containsAny(text: String, words: List<String>): Boolean = words.any { text.contains(it) }

/** Mirrors `matchesOnlyAudience` — needs `result.matchedTerms`, which this port keeps (see
 * `Fusion.kt`). */
private fun matchesOnlyAudience(group: RankedGroup): Boolean {
    val terms = group.results.flatMap { it.matchedTerms }
    return terms.isNotEmpty() && terms.all { term -> AUDIENCE_TERM_PREFIXES.any { normalizeSurfaceText(term).startsWith(it) } }
}

/** Mirrors `inferRequestedAudience`. The TS regexes for the age-number cases
 * (`\d{1,2}\s*(?:месяц...)`) have no Cyrillic character-class ranges, only literal word
 * alternation after a digit group — ported as a manual digit+unit scan for the same
 * Regex-avoidance reasons as the rest of this file. */
fun inferRequestedAudience(query: String): String? {
    val normalized = normalizeSurfaceText(query)
    for (i in normalized.indices) {
        if (normalized[i] !in '0'..'9') continue
        if (i > 0 && normalized[i - 1] != ' ') continue
        var j = i
        while (j < normalized.length && normalized[j] in '0'..'9') j += 1
        if (j - i > 2) continue
        var k = j
        while (k < normalized.length && normalized[k] == ' ') k += 1
        for (unit in listOf("месяцев", "месяца", "месяц", "мес")) {
            if (normalized.startsWith(unit, k)) {
                val after = k + unit.length
                val boundaryOk = after >= normalized.length || normalized[after] == ' ' ||
                    normalized[after] == ',' || normalized[after] == '.'
                if (boundaryOk) return "children"
            }
        }
    }
    for (i in normalized.indices) {
        if (normalized[i] !in '0'..'9') continue
        if (i > 0 && normalized[i - 1] != ' ') continue
        var j = i
        while (j < normalized.length && normalized[j] in '0'..'9') j += 1
        if (j - i > 3) continue
        var k = j
        while (k < normalized.length && normalized[k] == ' ') k += 1
        for (unit in listOf("года", "год", "лет")) {
            if (normalized.startsWith(unit, k)) {
                val after = k + unit.length
                val boundaryOk = after >= normalized.length || normalized[after] == ' ' ||
                    normalized[after] == ',' || normalized[after] == '.'
                if (boundaryOk) {
                    // `i` is itself a digit and the scan only advanced `j` over digits, so this
                    // substring is always a non-empty run of ASCII digits — always parses.
                    val years = normalized.substring(i, j).toInt()
                    return if (years < 18) "children" else "adults"
                }
            }
        }
    }
    val childSignal = containsAny(normalized, CHILD_AUDIENCE_WORDS)
    val adultSignal = containsAny(normalized, ADULT_AUDIENCE_WORDS)
    if (childSignal == adultSignal) return null
    return if (childSignal) "children" else "adults"
}

/** Mirrors `audiencePriority`. */
private fun audiencePriority(ageGroups: List<String>, audience: String): Int {
    val supportsChildren = ageGroups.any { it == "children" || it == "adolescents" }
    val supportsAdults = "adults" in ageGroups
    if (!supportsChildren && !supportsAdults) return 1
    return if (audience == "children") (if (supportsChildren) 2 else 0) else (if (supportsAdults) 2 else 0)
}

/** Mirrors `rankSearchGroupsByAudience`. Always tags `documentKind` (regardless of whether
 * `audience` is set); reorders only when `audience` is non-null. The TS source's `title` audience
 * label prefix is display-only and not ported (does not feed any compared field). */
fun rankSearchGroupsByAudience(groups: List<RankedGroup>, documentsById: Map<String, DocumentDescriptor>, audience: String?): List<RankedGroup> {
    val annotated = groups.map { group ->
        val document = documentsById[group.documentId]
        group.copy(documentKind = document?.let { searchResultDocumentKind(it) } ?: group.documentKind)
    }
    if (audience == null) return annotated
    return annotated.mapIndexed { index, group -> Triple(group, index, matchesOnlyAudience(group)) }
        .sortedWith(
            compareBy<Triple<RankedGroup, Int, Boolean>> { it.third } // audienceOnly ascending: false (0) before true (1)
                .thenByDescending {
                    val document = documentsById[it.first.documentId]
                    audiencePriority(document?.ageGroups ?: emptyList(), audience)
                }
                .thenBy { it.second },
        ).map { it.first }
}

/** Mirrors `clinicalCasePriority`/`preferClinicalRecommendationForCaseQueries`. */
private fun clinicalCasePriority(kind: String?): Int? = when (kind) {
    "clinical-recommendation" -> 0
    "reference" -> 1
    else -> null
}

fun preferClinicalRecommendationForCaseQueries(groups: List<RankedGroup>): List<RankedGroup> {
    val relevantIndexes = groups.indices.filter { clinicalCasePriority(groups[it].documentKind) != null }
    if (relevantIndexes.size < 2) return groups
    val reordered = relevantIndexes.map { groups[it] }
        .sortedBy { clinicalCasePriority(it.documentKind) ?: 0 }
    val result = groups.toMutableList()
    relevantIndexes.forEachIndexed { position, index -> result[index] = reordered[position] }
    return result
}

/** Mirrors `strictLookupIdentityPriority`. */
private fun strictLookupIdentityPriority(query: String, document: DocumentDescriptor?): Int {
    if (document == null) return 0
    val subject = normalizeSurfaceText(searchSubjectText(query)).trim()
    if (subject.isEmpty()) return 0
    if (normalizeSurfaceText(document.title).trim() == subject) return 2
    if (document.navigationAliases.any { normalizeSurfaceText(it).trim() == subject }) return 1
    return 0
}

/** Mirrors `preserveStrictIdentities`. */
fun preserveStrictIdentities(groups: List<RankedGroup>, query: String, documentsById: Map<String, DocumentDescriptor>): List<RankedGroup> {
    return groups.mapIndexed { index, group -> Triple(group, index, strictLookupIdentityPriority(query, documentsById[group.documentId])) }
        .sortedWith(compareByDescending<Triple<RankedGroup, Int, Int>> { it.third }.thenBy { it.second })
        .map { it.first }
}

private fun stemmedTokens(value: String): List<String> =
    exactWords(value).map { lightStemRussian(it) }

/** Mirrors `isMedicationSearchDocument`. */
private fun isMedicationSearchDocument(document: DocumentDescriptor): Boolean {
    if (searchResultDocumentKind(document) == "medication") return true
    if (document.sourceType != "rls_mkb_reference") return false
    return document.catalogFamily == "medication" || document.entityType == "medication"
}

/**
 * Mirrors the reachable branch of `filterMedicationDocuments` for lookup-mode analysis — see file
 * header. Drops a medication-kind group unless its title names a stemmed word (length >= 4) from
 * the original query.
 */
fun filterMedicationDocuments(groups: List<RankedGroup>, originalQuery: String, documentsById: Map<String, DocumentDescriptor>): List<RankedGroup> {
    val queryStems = stemmedTokens(originalQuery).toSet()
    fun titleNamedInQuery(title: String): Boolean = stemmedTokens(title).any { it.length >= 4 && it in queryStems }
    return groups.filter { group ->
        val document = documentsById[group.documentId] ?: return@filter true
        if (!isMedicationSearchDocument(document)) return@filter true
        titleNamedInQuery(group.title)
    }
}
