package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.AliasRecord
import dev.localmed.nativespike.shared.model.RankedGroup
import dev.localmed.nativespike.shared.model.RankedResult
import dev.localmed.nativespike.shared.text.MIN_FUZZY_TOKEN_LENGTH
import dev.localmed.nativespike.shared.text.normalizeSurfaceText
import dev.localmed.nativespike.shared.text.tokenize

/**
 * A Kotlin port of `groupResults`/`requestedSectionType`/`filterSuffixFallbackGroups`/
 * `filterSupersededSummaryResults`/`exactMedicationAliasCandidates`/`suffixFallbackCanonicalTerms`
 * (packages/core/src/create-medical-core.ts) — stage 2 sub-stage D. `groupResults` here is
 * narrowed to what `bestScore`/order/`documentKind`/`contentKind` (this migration's compared
 * fields) actually need: the WITHIN-group sort (`preferredSectionType`/`demoteMetaSections`/
 * presentation-alias/snippet-coverage tie-breaks) picks which result is "first" for `title` and a
 * cosmetic trade-name presentation prefix, but every result in a group shares one `documentId` and
 * therefore one `documentTitle` — so skipping that inner sort cannot change `bestScore` (already a
 * `max()` over the whole group, order-independent) or which document a group represents. It only
 * changes a display-only `title` prefix (`selectedGroupPresentation`, not ported) this migration
 * never compares. The BETWEEN-group `preferredSectionType` sort IS ported (`requestedDifference`
 * below) since it is a real, order-affecting tie-break `rankSearchGroupsByQuery`'s own `index`
 * tie-break preserves.
 *
 * `requestedSectionType` is a plain substring/prefix scan, not `Regex` — its TS source has
 * `[а-я]*` Cyrillic character-class ranges (`интенсивн[а-я]*`, `красн[а-я]*`, `препарат[а-я]*`),
 * the exact shape flagged risky on Kotlin/Native elsewhere in this port. A documented, honest
 * simplification: it checks word containment, not the TS regex's exact boundary/suffix shape — a
 * minor between-group tie-break signal, not a scoring term.
 */

private fun startsWordAt(text: String, index: Int): Boolean = index == 0 || text[index - 1].isWhitespace()

private fun containsWordPrefixed(text: String, word: String): Boolean {
    var index = text.indexOf(word)
    while (index >= 0) {
        if (startsWordAt(text, index)) return true
        index = text.indexOf(word, index + 1)
    }
    return false
}

/** Mirrors `requestedSectionType`, simplified per this file's header. */
fun requestedSectionType(query: String): String? {
    if (
        containsWordPrefixed(query, "диагностик") ||
        query.contains("какие обследовани") || query.contains("какие анализ") ||
        query.contains("нужны ли обследовани") || query.contains("нужны ли анализ") ||
        query.contains("подтвердить диагноз") || query.contains("подтвердити диагноз")
    ) {
        return "diagnostics"
    }
    if (
        query.contains("маршрутизац") || query.contains("госпитализ") || query.contains("экстренн") ||
        query.contains("реанимац") ||
        (query.contains("интенсивн") && (query.contains("помощ") || query.contains("терапи"))) ||
        (query.contains("красн") && query.contains("флаг")) ||
        query.contains("что делать")
    ) {
        return "routing"
    }
    if (
        containsWordPrefixed(query, "лечени") || containsWordPrefixed(query, "лечить") ||
        containsWordPrefixed(query, "терапи") ||
        containsWordPrefixed(query, "показани") || containsWordPrefixed(query, "применени") ||
        containsWordPrefixed(query, "применять") || containsWordPrefixed(query, "применяют") ||
        query.contains("отпаива") || query.contains("чем поить") ||
        query.contains("антибиотик") ||
        (query.contains("препарат") && query.contains("выбора")) ||
        query.contains("дозировк")
    ) {
        return "treatment"
    }
    return null
}

private data class MedicationAliasCandidate(
    val alias: String,
    val normalizedAlias: String,
    val normalizedCanonicalTerm: String,
)

/** Mirrors `exactMedicationAliasCandidates` (without the TS `WeakMap` memoization — same stance as
 * the rest of this port, see `Aliases.kt`'s header). */
private fun exactMedicationAliasCandidates(query: String, aliases: List<AliasRecord>): List<MedicationAliasCandidate> {
    val prepared = aliases
        .filter { it.category == "medication" }
        .map { MedicationAliasCandidate(it.alias, normalizeSurfaceText(it.alias), normalizeSurfaceText(it.canonicalTerm)) }
        .filter { it.normalizedAlias != it.normalizedCanonicalTerm }
    val normalizedQuery = normalizeSurfaceText(query)
    return prepared
        .filter { findNormalizedPhraseIndex(normalizedQuery, it.normalizedAlias) >= 0 }
        .sortedByDescending { it.normalizedAlias.length }
}

/** Mirrors `suffixFallbackCanonicalTerms`. */
private fun suffixFallbackCanonicalTerms(query: String, aliases: List<AliasRecord>): Set<String> {
    val normalizedQuery = normalizeSurfaceText(query)
    val queryTokens = tokenize(normalizedQuery)
    val queryToken = if (queryTokens.size == 1) queryTokens[0] else null
    if (queryToken == null || queryToken.length < MIN_FUZZY_TOKEN_LENGTH) return emptySet()
    val hasExactSingleTokenMedicationAlias = aliases.any { alias ->
        if (alias.category != "medication") return@any false
        val normalizedAlias = normalizeSurfaceText(alias.alias)
        normalizedAlias == normalizedQuery && tokenize(normalizedAlias).size == 1
    }
    if (hasExactSingleTokenMedicationAlias) return emptySet()

    val canonicalTerms = LinkedHashSet<String>()
    for (alias in aliases) {
        if (alias.category != "medication") continue
        val normalizedAlias = normalizeSurfaceText(alias.alias)
        val aliasTokens = tokenize(normalizedAlias)
        if (
            aliasTokens.size != 2 ||
            findNormalizedPhraseIndex(normalizedQuery, normalizedAlias) >= 0 ||
            fuzzyPhraseSpan(normalizedQuery, normalizedAlias) == null
        ) {
            continue
        }
        canonicalTerms.add(normalizeSurfaceText(alias.canonicalTerm))
    }
    return canonicalTerms
}

/** Mirrors `filterSuffixFallbackGroups`. */
fun filterSuffixFallbackGroups(
    groups: List<RankedGroup>,
    query: String,
    aliases: List<AliasRecord>,
    protectedDocumentIds: Set<String> = emptySet(),
): List<RankedGroup> {
    val canonicalTerms = suffixFallbackCanonicalTerms(query, aliases)
    if (canonicalTerms.isEmpty()) return groups
    val canonicalDocumentIds = groups
        .filter { group -> group.results.any { normalizeSurfaceText(it.documentTitle) in canonicalTerms } }
        .map { it.documentId }
        .toSet()
    if (canonicalDocumentIds.isEmpty()) return groups
    return groups.filter { it.documentId in canonicalDocumentIds || it.documentId in protectedDocumentIds }
}

/** Mirrors `filterSupersededSummaryResults`. */
fun filterSupersededSummaryResults(results: List<RankedResult>, availableDocumentIds: Set<String>): List<RankedResult> =
    results.filter { !isSupersededSummaryDocument(it.documentId, availableDocumentIds) }

/**
 * Mirrors `groupResults`, narrowed per this file's header: groups by document, `bestScore = max
 * finalScore`, between-group sort by (preferred-section-type presence, bestScore).
 */
fun groupResults(results: List<RankedResult>, preferredSectionType: String?): List<RankedGroup> {
    val byDocument = LinkedHashMap<String, MutableList<RankedResult>>()
    for (result in results) byDocument.getOrPut(result.documentId) { mutableListOf() }.add(result)
    val groups = byDocument.map { (documentId, documentResults) ->
        val first = documentResults.first()
        RankedGroup(
            documentId = documentId,
            title = first.documentTitle,
            bestScore = documentResults.maxOf { it.finalScore },
            results = documentResults,
        )
    }
    return groups.sortedWith(
        compareByDescending<RankedGroup> { group ->
            if (preferredSectionType != null) group.results.any { it.sectionType == preferredSectionType } else false
        }.thenByDescending { it.bestScore },
    )
}
