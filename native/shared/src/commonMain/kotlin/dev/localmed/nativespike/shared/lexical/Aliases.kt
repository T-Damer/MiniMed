package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.AliasExpansion
import dev.localmed.nativespike.shared.model.AliasMatchSpan
import dev.localmed.nativespike.shared.model.AliasMatchType
import dev.localmed.nativespike.shared.model.AliasRecord
import dev.localmed.nativespike.shared.model.TextRange
import dev.localmed.nativespike.shared.text.MIN_FUZZY_TOKEN_LENGTH
import dev.localmed.nativespike.shared.text.isCloseToken
import dev.localmed.nativespike.shared.text.isTokenChar
import dev.localmed.nativespike.shared.text.normalizeSurfaceText
import dev.localmed.nativespike.shared.text.tokenize

/**
 * A Kotlin port of `packages/search-lexical/src/aliases.ts` — stage 2 sub-stage A of the migration
 * recorded in docs/CURRENT_STATE.md. Structure and naming stay close to the TS source; comments
 * link back to it. Ported: `findNormalizedPhraseIndex`, `fuzzyPhraseSpan`/`fuzzyTokenSpan`,
 * `createAliasExpander`/`expandAliases` (exact + bag-of-words fuzzy matching, the exact-span
 * containment rule, the exact-vs-fuzzy dedup rule). Not ported: the `WeakMap`-keyed
 * memoization `expandAliases` uses in TS to reuse a prepared expander across calls with the same
 * alias list by object identity — callers here should call `createAliasExpander` once themselves
 * and reuse the returned function (same intent, explicit instead of implicit).
 */

// Only device-like two-token aliases get a single-token fallback; form aliases stay exact-only.
private const val MIN_FUZZY_FINAL_ALIAS_TOKEN_LENGTH = 10

/** Mirrors `findNormalizedPhraseIndex`. */
fun findNormalizedPhraseIndex(text: String, phrase: String): Int {
    if (phrase.isEmpty()) return -1
    var index = text.indexOf(phrase)
    while (index >= 0) {
        val before = if (index - 1 >= 0) text[index - 1] else null
        val after = if (index + phrase.length < text.length) text[index + phrase.length] else null
        if ((before == null || !isTokenChar(before)) && (after == null || !isTokenChar(after))) {
            return index
        }
        index = text.indexOf(phrase, index + 1)
    }
    return -1
}

/** Mirrors `fuzzyPhraseSpan`. */
fun fuzzyPhraseSpan(normalizedQuery: String, normalizedPhrase: String): TextRange? =
    fuzzyTokenSpan(normalizedQuery, tokenize(normalizedQuery), tokenize(normalizedPhrase), ::isCloseToken)

/** Mirrors the private `fuzzyTokenSpan` in aliases.ts. */
private fun fuzzyTokenSpan(
    normalizedQuery: String,
    queryTokens: List<String>,
    phraseTokens: List<String>,
    close: (String, String) -> Boolean,
): TextRange? {
    if (phraseTokens.isEmpty()) return null
    if (phraseTokens.none { it.length >= MIN_FUZZY_TOKEN_LENGTH }) return null

    if (queryTokens.size == 1 && phraseTokens.size == 2) {
        val queryToken = queryTokens[0]
        val finalPhraseToken = phraseTokens[1]
        if (queryToken.length < MIN_FUZZY_TOKEN_LENGTH ||
            finalPhraseToken.length < MIN_FUZZY_FINAL_ALIAS_TOKEN_LENGTH ||
            !close(finalPhraseToken, queryToken)
        ) {
            return null
        }
        val tokenIndex = findNormalizedPhraseIndex(normalizedQuery, queryToken)
        if (tokenIndex < 0) return null
        return TextRange(tokenIndex, tokenIndex + queryToken.length)
    }

    val usedQueryTokenIndexes = mutableSetOf<Int>()
    var start = Int.MAX_VALUE
    var end = Int.MIN_VALUE

    for (phraseToken in phraseTokens) {
        val matchIndex = queryTokens.indices.firstOrNull { index ->
            index !in usedQueryTokenIndexes && close(phraseToken, queryTokens[index])
        } ?: return null
        usedQueryTokenIndexes.add(matchIndex)

        val matchedToken = queryTokens[matchIndex]
        val tokenIndex = findNormalizedPhraseIndex(normalizedQuery, matchedToken)
        if (tokenIndex < 0) return null
        start = minOf(start, tokenIndex)
        end = maxOf(end, tokenIndex + matchedToken.length)
    }

    return TextRange(start, end)
}

private class PreparedAlias(
    val alias: AliasRecord,
    val normalized: String,
    val tokens: List<String>,
)

/** Mirrors `AliasExpander` (a function type in TS; a fun interface here for the same call shape). */
fun interface AliasExpander {
    fun expand(query: String): AliasExpansion
}

/**
 * Mirrors `createAliasExpander`: a core-owned vocabulary snapshot. Rebuild after
 * installing/removing/reinitializing content — i.e. call this once per `List<AliasRecord>` snapshot
 * and reuse the returned `AliasExpander`, not once per query.
 */
fun createAliasExpander(aliases: List<AliasRecord>): AliasExpander {
    val prepared = aliases
        .sortedByDescending { it.alias.length }
        .map { alias ->
            PreparedAlias(
                alias = alias,
                normalized = normalizeSurfaceText(alias.alias),
                tokens = tokenize(alias.alias),
            )
        }
    // Every fuzzy match must match the first significant alias token. The only exception is the
    // documented one-token/device fallback, which indexes its final token as well.
    val heads = HashMap<Int, MutableMap<String, MutableSet<PreparedAlias>>>()
    for (item in prepared) {
        val headTokens = buildList {
            item.tokens.getOrNull(0)?.let { add(it) }
            if (item.tokens.size == 2 && (item.tokens[1].length) >= MIN_FUZZY_FINAL_ALIAS_TOKEN_LENGTH) {
                add(item.tokens[1])
            }
        }
        for (token in headTokens) {
            val bucket = heads.getOrPut(token.length) { HashMap() }
            val entries = bucket.getOrPut(token) { LinkedHashSet() }
            entries.add(item)
        }
    }
    return AliasExpander { query -> expandPreparedAliases(query, prepared, heads) }
}

/** Mirrors `expandAliases` minus the TS `WeakMap` memoization (see file header). */
fun expandAliases(query: String, aliases: List<AliasRecord>): AliasExpansion =
    createAliasExpander(aliases).expand(query)

/** Mirrors the private `expandPreparedAliases` in aliases.ts. */
private fun expandPreparedAliases(
    query: String,
    aliases: List<PreparedAlias>,
    heads: Map<Int, Map<String, Set<PreparedAlias>>>,
): AliasExpansion {
    val normalizedQuery = normalizeSurfaceText(query)
    val queryTokens = tokenize(normalizedQuery)
    // Long vocabularies repeat tokens (e.g. синдром) in many phrases. Compare each pair once.
    val comparisons = HashMap<String, MutableMap<String, Boolean>>()
    val close: (String, String) -> Boolean = close@{ left, right ->
        if (left == right) return@close true
        val compared = comparisons.getOrPut(right) { HashMap() }
        compared.getOrPut(left) { isCloseToken(left, right) }
    }

    val candidates = HashSet<PreparedAlias>()
    for (queryToken in queryTokens.toSet()) {
        for (length in maxOf(1, queryToken.length - 2)..(queryToken.length + 2)) {
            for ((token, entries) in heads[length].orEmpty()) {
                if (!close(token, queryToken)) continue
                candidates.addAll(entries)
            }
        }
    }

    val terms = LinkedHashSet<String>()
    val matches = mutableListOf<String>()
    val matchedAliases = mutableListOf<AliasRecord>()
    val matchSpans = mutableListOf<AliasMatchSpan>()

    for (prepared in aliases) {
        val alias = prepared.alias
        val normalizedAlias = prepared.normalized
        val exactIndex = findNormalizedPhraseIndex(normalizedQuery, normalizedAlias)
        val matchType = if (exactIndex >= 0) AliasMatchType.EXACT else AliasMatchType.FUZZY
        var span: TextRange? = if (exactIndex >= 0) {
            TextRange(exactIndex, exactIndex + normalizedAlias.length)
        } else if (candidates.contains(prepared)) {
            fuzzyTokenSpan(normalizedQuery, queryTokens, prepared.tokens, close)
        } else {
            null
        }
        if (span == null) continue

        // Prefer an explicit longer name (МКБ-10) over an embedded abbreviation (МКБ), while
        // retaining every meaning that matches the same complete span.
        while (span != null) {
            val current = span
            val covered = matchSpans.any { match ->
                match.matchType == AliasMatchType.EXACT &&
                    match.range.start <= current.start && match.range.end >= current.end &&
                    (match.range.start < current.start || match.range.end > current.end)
            }
            if (!covered) break
            val offset = span.end
            val next = if (matchType == AliasMatchType.EXACT) {
                findNormalizedPhraseIndex(normalizedQuery.substring(offset), normalizedAlias)
            } else {
                -1
            }
            span = if (next < 0) null else TextRange(offset + next, offset + next + normalizedAlias.length)
        }
        if (span == null) continue
        matchSpans.add(AliasMatchSpan(alias, span, matchType))
    }

    // Fuzzy matching repairs misspellings. A word that already names a known alias exactly is not
    // misspelled, so fuzzy neighbours of that same span must not pour their unrelated canonical
    // terms into the query. A longer fuzzy match that only contains an exact one still repairs a
    // typo.
    val exactRanges = matchSpans.filter { it.matchType == AliasMatchType.EXACT }.map { it.range }
    val kept = matchSpans.filter { match ->
        match.matchType == AliasMatchType.EXACT ||
            exactRanges.none { range -> range.start <= match.range.start && match.range.end <= range.end }
    }
    for (match in kept) {
        matches.add("${match.alias.alias} → ${match.alias.canonicalTerm}")
        matchedAliases.add(match.alias)
        for (term in tokenize(match.alias.canonicalTerm)) terms.add(term)
    }

    return AliasExpansion(terms.toList(), matches, matchedAliases, kept)
}
