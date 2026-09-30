package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.AliasRecord
import dev.localmed.nativespike.shared.model.RankedGroup
import dev.localmed.nativespike.shared.model.RankedResult
import dev.localmed.nativespike.shared.text.MIN_FUZZY_TOKEN_LENGTH
import dev.localmed.nativespike.shared.text.normalizeSurfaceText
import dev.localmed.nativespike.shared.text.tokenize

/** Source excerpt ordering and document grouping mirror core/create-medical-core.ts. */

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
private fun snippetQueryTokenCoverage(result: RankedResult, terms: List<String>): Int {
    val words = tokenize(result.snippet).filter { it.length >= 4 }
    return terms.flatMap(::tokenize).filter { it.length >= 4 }.toSet().count { term ->
        words.any { it == term || it.startsWith(term) || term.startsWith(it) }
    }
}

private fun presentationAliasSnippetBoost(result: RankedResult, candidates: List<MedicationAliasCandidate>): Int {
    val snippet = normalizeSurfaceText(result.snippet)
    return if (candidates.any { candidate ->
        listOf("тн:", "торговое наименование:").any { field ->
            findNormalizedPhraseIndex(snippet, "$field ${candidate.normalizedAlias}.") >= 0
        }
    }) 1 else 0
}

private val tradeNameField = Regex("(?:^|[.;])\\s*(?:…\\s*)?(?:-\\s*)?(?:тн|торговое\\s+наименование)\\s*:\\s*([^.;\\n]+)", RegexOption.IGNORE_CASE)
private fun selectedGroupPresentation(first: RankedResult, query: String, terms: List<String>, aliases: List<MedicationAliasCandidate>): String? {
    val candidates = aliases.filter { it.normalizedCanonicalTerm == normalizeSurfaceText(first.documentTitle) }
    val queryAlias = candidates.firstOrNull()?.alias
    val normalizedTerms = (terms + tokenize(query)).map(::normalizeSurfaceText).filter { it.length >= 3 }.toSet()
    data class Name(val value: String, val matches: Int, val exact: Boolean)
    val snippetTradeName = first.snippet.split(Regex("\\r?\\n")).flatMap { line ->
        tradeNameField.findAll(line).map { match ->
            val value = match.groupValues[1].trim()
            Name(value, normalizedTerms.count { normalizeSurfaceText(line).contains(it) },
                candidates.any { it.normalizedAlias == normalizeSurfaceText(value) })
        }.filter { it.value.isNotEmpty() }.toList()
    }.sortedWith(compareByDescending<Name> { it.matches }.thenByDescending { it.exact }).firstOrNull()?.value
    if (queryAlias == null || snippetTradeName == null) return queryAlias
    return if (tokenize(snippetTradeName).size > tokenize(queryAlias).size) snippetTradeName else queryAlias
}

fun groupResults(results: List<RankedResult>, preferredSectionType: String?, query: String = "", terms: List<String> = emptyList(), aliases: List<AliasRecord> = emptyList()): List<RankedGroup> {
    val candidates = exactMedicationAliasCandidates(query, aliases)
    val exactCandidates = candidates.filter { it.normalizedAlias == normalizeSurfaceText(query) }
    val demoteMeta = !normalizeSurfaceText(query).contains("ограничен")
    fun meta(result: RankedResult): Boolean = normalizeSurfaceText(result.sectionPath.lastOrNull() ?: "") in
        setOf("ограничения", "источник и ограничения")
    val byDocument = LinkedHashMap<String, MutableList<RankedResult>>()
    for (result in results) byDocument.getOrPut(result.documentId) { mutableListOf() }.add(result)
    val groups = byDocument.map { (documentId, documentResults) ->
        val sorted = documentResults.sortedWith(
            compareByDescending<RankedResult> { preferredSectionType != null && it.sectionType == preferredSectionType }
                .thenBy { demoteMeta && meta(it) }
                .thenByDescending { presentationAliasSnippetBoost(it, exactCandidates) }
                .thenByDescending { snippetQueryTokenCoverage(it, listOf(query)) }
                .thenByDescending { snippetQueryTokenCoverage(it, terms) }
                .thenByDescending { it.finalScore },
        )
        val first = sorted.first()
        val presentation = selectedGroupPresentation(first, query, terms, candidates)
        RankedGroup(documentId, if (presentation != null) "$presentation · ${first.documentTitle}" else first.documentTitle,
            documentResults.maxOf { it.finalScore }, sorted)
    }
    return groups.sortedWith(
        compareByDescending<RankedGroup> { group ->
            if (preferredSectionType != null) group.results.any { it.sectionType == preferredSectionType } else false
        }.thenByDescending { it.bestScore },
    )
}
