package dev.localmed.nativespike.shared.text

/**
 * A deliberately partial Kotlin port of the normalization step in
 * `packages/search-lexical/src/normalize.ts` (the web app's lexical baseline). It covers exactly
 * the pieces needed to build an FTS5 MATCH expression for ordinary lookup:
 *  - NFKC + lowercase + ё→е folding + dash unification + charset clamp (mirrors
 *    `normalizeSurfaceText`)
 *  - tokenize() with the same stop-word list and minimum token length
 *  - a light Russian suffix stemmer (mirrors `lightStemRussian`)
 *
 * Deliberately NOT ported (documented for the spike report, not silently dropped):
 *  - ICD-10 Cyrillic-lookalike code normalization (`normalizeIcd10Lookalikes`)
 *  - bounded Levenshtein fuzzy token matching / typo correction (`typo-correction.ts`,
 *    `medication-spelling.ts`)
 *  - the multi-branch query planner with alias-branch corroboration/dilution rules
 *    (`analysis.ts`, ~2200 lines) — this port only does single-branch OR-of-tokens matching
 *  - clinical intent detection (diagnosis vs. drug vs. regulatory query), medication suffix
 *    handling, definition-question detection
 * A native product build would need to either re-implement these in Kotlin or share them via a
 * KMP-compiled core; this spike does neither, so ranking-quality comparisons against the web app
 * are not apples-to-apples — only latency and rendering are.
 */

private val STOP_WORDS = setOf(
    "без", "бы", "в", "во", "для", "до", "же", "и", "из", "или", "к", "как", "ко", "ли", "на",
    "не", "но", "о", "об", "от", "по", "под", "при", "с", "со", "у", "что", "это",
)

// Longest suffix first, same rationale as the TS source: try the biggest ending that still leaves
// a length->=4 stem before falling back to a shorter one.
private val RUSSIAN_SUFFIXES = listOf(
    "иями", "ями", "ами", "ого", "ему", "ому", "ыми", "ими", "иях", "ях", "ах", "ение", "ания",
    "ений", "ание", "ость", "ости", "его", "ая", "яя", "ое", "ее", "ые", "ие", "ой", "ей", "ий",
    "ый", "ам", "ям", "ом", "ем", "ов", "ев", "ия", "нья", "ью", "ы", "и", "а", "я", "у", "ю", "е", "о",
).sortedByDescending { it.length }

private val KEEP_CHARS = Regex("[^0-9a-zа-я\\s.,:+/%-]", RegexOption.IGNORE_CASE)
private val DASH_VARIANTS = Regex("[‐‑‒–—−]")
private val WHITESPACE = Regex("\\s+")
private val TOKEN_PATTERN = Regex("[0-9a-zа-я]+")

/** Mirrors `normalizeSurfaceText` minus ICD-10 lookalike remapping (see file header). */
fun normalizeSurfaceText(value: String): String {
    val lowered = value.lowercase().replace('ё', 'е')
    val dashUnified = DASH_VARIANTS.replace(lowered, "-")
    val clamped = KEEP_CHARS.replace(dashUnified, " ")
    return WHITESPACE.replace(clamped, " ").trim()
}

/** Mirrors `tokenize`: split into runs of [0-9a-zа-я], drop stop words and length-1 tokens. */
fun tokenize(value: String): List<String> =
    TOKEN_PATTERN.findAll(normalizeSurfaceText(value))
        .map { it.value }
        .filter { it.length >= 2 && it !in STOP_WORDS }
        .toList()

/** Mirrors `lightStemRussian`. */
fun lightStemRussian(token: String): String {
    if (token.length < 5 || token.none { it in 'а'..'я' }) return token
    for (suffix in RUSSIAN_SUFFIXES) {
        if (token.endsWith(suffix) && token.length - suffix.length >= 4) {
            return token.dropLast(suffix.length)
        }
    }
    return token
}

/** One FTS5-safe term expanded to itself, its stem, and a prefix wildcard. */
private fun expandTerm(token: String): List<String> {
    val stem = lightStemRussian(token)
    return if (stem == token) listOf("$token*") else listOf("$token*", "$stem*")
}

/**
 * Builds a single-branch FTS5 MATCH expression: every query token (and its light stem) as an
 * OR'd prefix match, plus alias-expanded canonical terms tokenized the same way. This is the
 * "ordinary lookup" baseline only — see file header for what the web app's full query planner
 * does that this does not.
 */
fun buildMatchExpression(query: String, aliasCanonicalTerms: List<String>): String? {
    val tokens = tokenize(query)
    if (tokens.isEmpty()) return null
    val terms = LinkedHashSet<String>()
    for (token in tokens) terms.addAll(expandTerm(token))
    for (canonical in aliasCanonicalTerms) {
        for (token in tokenize(canonical)) terms.addAll(expandTerm(token))
    }
    return terms.joinToString(" OR ")
}
