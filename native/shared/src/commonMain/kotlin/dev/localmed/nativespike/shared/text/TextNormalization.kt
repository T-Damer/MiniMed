package dev.localmed.nativespike.shared.text

/**
 * A Kotlin port of the normalization step in `packages/search-lexical/src/normalize.ts` (the web
 * app's lexical baseline). As of the migration's stage 2 sub-stage A (docs/CURRENT_STATE.md), this
 * covers:
 *  - lowercase + ё→е folding + dash unification + charset clamp + ICD-10 Cyrillic-lookalike code
 *    normalization (mirrors `normalizeSurfaceText`)
 *  - tokenize() with the same stop-word list and minimum token length
 *  - a light Russian suffix stemmer (mirrors `lightStemRussian`)
 *  - bounded Levenshtein distance and `isCloseToken` (mirrors normalize.ts's own — distinct from
 *    `rapidfuzz.ts`'s OSA/Levenshtein, ported separately in `lexical/RapidFuzz.kt`)
 *
 * Deliberately NOT ported (documented for the spike report, not silently dropped):
 *  - Unicode NFKC normalization (`value.normalize('NFKC')` in the TS source) — no NFKC
 *    implementation is available in Kotlin's common stdlib without per-platform work
 *    (`java.text.Normalizer` on the JVM has no Kotlin/Native or Kotlin/Wasm equivalent here).
 *    None of the 142 golden queries contain decomposed/compatibility Unicode forms that would
 *    make this visible, so it does not affect the golden-parity numbers, but it is a real gap for
 *    arbitrary future input.
 *  - `normalizeSurfaceTextWithOffsets` (only needed for downstream highlight-position mapping, not
 *    for query normalization or alias matching)
 *  - the multi-branch query planner with alias-branch corroboration/dilution rules
 *    (`analysis.ts`, ~2200 lines) — stage 2 sub-stage B
 *
 * `searchSubjectText` (navigation-preamble stripping) IS ported below (stage 2 sub-stage D) — the
 * fusion/grouping/ranking pipeline (`lexical/Fusion.kt`, `lexical/QueryGroupRanking.kt`) uses it to
 * find a query's "subject" for exact-title/navigation-alias matching.
 *  - clinical intent detection (diagnosis vs. drug vs. regulatory query), medication suffix
 *    handling, definition-question detection, typo-correction.ts — explicitly out of scope for
 *    stage 2 (see docs/CURRENT_STATE.md)
 */

private val STOP_WORDS = setOf(
    "без", "бы", "в", "во", "для", "до", "же", "и", "из", "или", "к", "как", "ко", "ли", "на",
    "не", "но", "о", "об", "от", "по", "под", "при", "с", "со", "у", "что", "это",
)

// Longest suffix first, same rationale as the TS source: try the biggest ending that still leaves
// a length->=4 stem before falling back to a shorter one.
// TS source (normalize.ts) has 'ья' here, not 'нья' — this Kotlin port previously had a typo that
// diverged from the TS suffix list (caught during stage 2 sub-stage A's golden-parity work, before
// any golden query happened to depend on it). Fixed to match.
private val RUSSIAN_SUFFIXES = listOf(
    "иями", "ями", "ами", "ого", "ему", "ому", "ыми", "ими", "иях", "ях", "ах", "ение", "ания",
    "ений", "ание", "ость", "ости", "его", "ая", "яя", "ое", "ее", "ые", "ие", "ой", "ей", "ий",
    "ый", "ам", "ям", "ом", "ем", "ов", "ев", "ия", "ья", "ью", "ы", "и", "а", "я", "у", "ю", "е", "о",
).sortedByDescending { it.length }

private val DASH_VARIANTS = Regex("[‐‑‒–—−]")
private val WHITESPACE = Regex("\\s+")

// Character-class checks below are plain Char-range comparisons, not Regex — found the hard way
// via iosSimulatorArm64Test: Kotlin/Native's Regex engine did not match the Cyrillic `а-я` range
// inside a `[...]` character class the same way the JVM does (normalizeSurfaceText/tokenize
// silently dropped every Cyrillic character on iOS, passing on Android/desktop the whole time —
// see docs/research/native-vs-webview-2026-09-28.md, "Multiplatform build and tests" for the
// before/after test run). Plain range comparisons on `Char` are basic UTF-16 code-unit arithmetic
// with no engine-specific Unicode-class behavior to diverge, so they're used everywhere below
// instead, even though a `Regex` would read slightly shorter.
// `internal`, not `private`: reused by `lexical/Aliases.kt`'s port of aliases.ts, which needs the
// same "is this a query/token character" test `findNormalizedPhraseIndex` uses.
internal fun isKeepableChar(c: Char): Boolean =
    c in '0'..'9' || c in 'a'..'z' || c in 'а'..'я' || c.isWhitespace() ||
        c == '.' || c == ',' || c == ':' || c == '+' || c == '/' || c == '%' || c == '-'

internal fun isTokenChar(c: Char): Boolean = c in '0'..'9' || c in 'a'..'z' || c in 'а'..'я'

private fun isIcd10LetterOrDigit(c: Char): Boolean =
    c in '0'..'9' || c in 'a'..'z' || c in 'A'..'Z' || c in 'А'..'я'

private fun clampCharset(value: String): String {
    val builder = StringBuilder(value.length)
    for (c in value) builder.append(if (isKeepableChar(c)) c else ' ')
    return builder.toString()
}

// Mirrors `ICD10_CYRILLIC_LOOKALIKE_MAP` (normalize.ts). By the time `normalizeIcd10Lookalikes`
// runs inside `normalizeSurfaceText` the string is already lowercased and charset-clamped (matches
// TS's call order), so only the lowercase entries are ever reachable there; the uppercase ones
// exist for parity with the TS function's own standalone contract (it is exported and could be
// called against un-lowercased text elsewhere).
private val ICD10_LOOKALIKE_MAP: Map<Char, Char> = mapOf(
    'А' to 'A', 'а' to 'a', 'В' to 'B', 'в' to 'b', 'С' to 'C', 'с' to 'c',
    'Е' to 'E', 'е' to 'e', 'Н' to 'H', 'н' to 'h', 'К' to 'K', 'к' to 'k',
    'М' to 'M', 'м' to 'm', 'О' to 'O', 'о' to 'o', 'Р' to 'P', 'р' to 'p',
    'Т' to 'T', 'т' to 't', 'Х' to 'X', 'х' to 'x', 'У' to 'Y', 'у' to 'y',
)

/**
 * Mirrors `normalizeIcd10Lookalikes` (normalize.ts): remaps Cyrillic lookalikes only inside an
 * ICD-10-code-shaped token (one letter, exactly two digits, then an optional `.`/`-` plus digits,
 * or more digits — the TS regex `ICD10_CODE_LIKE_PATTERN`), never elsewhere. Implemented as a
 * manual scan, not `Regex`, for the same Kotlin/Native Cyrillic-character-class reason documented
 * above this file's other char-class helpers — a lookbehind/lookahead regex would be even more at
 * risk of that divergence than a plain `[...]` class was.
 */
fun normalizeIcd10Lookalikes(value: String): String {
    val result = StringBuilder(value.length)
    var i = 0
    val n = value.length
    while (i < n) {
        val c = value[i]
        val precededByAlnum = i > 0 && isIcd10LetterOrDigit(value[i - 1])
        val isLetter = c in 'a'..'z' || c in 'A'..'Z' || c in 'А'..'я'
        if (!precededByAlnum && isLetter && i + 2 < n &&
            value[i + 1] in '0'..'9' && value[i + 2] in '0'..'9'
        ) {
            var end = i + 3
            if (end < n && (value[end] == '.' || value[end] == '-') && end + 1 < n && value[end + 1] in '0'..'9') {
                end += 1
                while (end < n && value[end] in '0'..'9') end += 1
            } else {
                while (end < n && value[end] in '0'..'9') end += 1
            }
            val followedByAlnum = end < n && isIcd10LetterOrDigit(value[end])
            if (!followedByAlnum) {
                for (j in i until end) result.append(ICD10_LOOKALIKE_MAP[value[j]] ?: value[j])
                i = end
                continue
            }
        }
        result.append(c)
        i += 1
    }
    return result.toString()
}

/** Mirrors `normalizeSurfaceText` (normalize.ts) except for Unicode NFKC folding (see file header). */
fun normalizeSurfaceText(value: String): String {
    val lowered = value.lowercase().replace('ё', 'е')
    val dashUnified = DASH_VARIANTS.replace(lowered, "-")
    val clamped = clampCharset(dashUnified)
    val collapsed = WHITESPACE.replace(clamped, " ").trim()
    return normalizeIcd10Lookalikes(collapsed)
}

/** Mirrors `tokenize`: split into runs of [0-9a-zа-я], drop stop words and length-1 tokens. */
fun tokenize(value: String): List<String> {
    val normalized = normalizeSurfaceText(value)
    val tokens = mutableListOf<String>()
    var start = -1
    for (i in normalized.indices) {
        if (isTokenChar(normalized[i])) {
            if (start < 0) start = i
        } else if (start >= 0) {
            tokens.add(normalized.substring(start, i))
            start = -1
        }
    }
    if (start >= 0) tokens.add(normalized.substring(start))
    return tokens.filter { it.length >= 2 && it !in STOP_WORDS }
}

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

/**
 * Mirrors `levenshteinDistance` (normalize.ts): exact edit distance when it is at most
 * `maxDistance`, otherwise `maxDistance + 1` — a cheap "too far" sentinel, not a real upper bound.
 * Unlike the TS source, this allocates a fresh row pair per call instead of reusing a module-level
 * buffer (that reuse was a hot-path micro-optimization for a per-keystroke UI; this is a
 * commonTest-scale port used once per golden query) — a documented perf simplification, not a
 * behavior difference. Distinct from `lexical/RapidFuzz.kt`'s `Levenshtein` (the `rapidfuzz.ts`
 * port): this one is the band-limited variant `aliases.ts` actually calls via `isCloseToken`.
 */
fun levenshteinDistanceBounded(left: String, right: String, maxDistance: Int): Int {
    if (left == right) return 0
    if (kotlin.math.abs(left.length - right.length) > maxDistance) return maxDistance + 1
    val over = maxDistance + 1
    val width = right.length + 1
    var previousRow = IntArray(width) { if (it <= maxDistance) it else over }
    var currentRow = IntArray(width)
    for (i in 1..left.length) {
        val from = maxOf(1, i - maxDistance)
        val to = minOf(right.length, i + maxDistance)
        currentRow[0] = if (i <= maxDistance) i else over
        if (from > 1) currentRow[from - 1] = over
        var rowMin = currentRow[0]
        val leftChar = left[i - 1]
        for (j in from..to) {
            val substitute = previousRow[j - 1] + if (leftChar == right[j - 1]) 0 else 1
            val remove = previousRow[j] + 1
            val insert = currentRow[j - 1] + 1
            val value = minOf(over, substitute, remove, insert)
            currentRow[j] = value
            if (value < rowMin) rowMin = value
        }
        if (to < right.length) currentRow[to + 1] = over
        if (rowMin > maxDistance) return over
        val swap = previousRow
        previousRow = currentRow
        currentRow = swap
    }
    return minOf(over, previousRow[right.length])
}

/**
 * Below this length, single-edit typos are indistinguishable from genuinely different clinical
 * words — mirrors normalize.ts's `MIN_FUZZY_TOKEN_LENGTH`.
 */
const val MIN_FUZZY_TOKEN_LENGTH = 5
private const val LONG_FUZZY_TOKEN_LENGTH = 9

/** Mirrors `isCloseToken` (normalize.ts): exact for short tokens, bounded edit distance otherwise. */
fun isCloseToken(left: String, right: String): Boolean {
    if (left == right) return true
    if (left.length < MIN_FUZZY_TOKEN_LENGTH || right.length < MIN_FUZZY_TOKEN_LENGTH) return false
    val maxDistance = if (maxOf(left.length, right.length) >= LONG_FUZZY_TOKEN_LENGTH) 2 else 1
    return levenshteinDistanceBounded(left, right, maxDistance) <= maxDistance
}

// searchSubjectText's two TS regexes are both anchored at `^` and match one of a small, fixed set
// of literal Russian navigation phrases — enumerated here as plain prefix strings (no Regex; same
// Kotlin/Native Cyrillic-character-class caution as the rest of this file) rather than a general
// pattern matcher, since that is exactly what the TS alternation is.
private val SUBJECT_PREFIX_GROUP_A = listOf("описание болезни ", "описание заболевания ")
private val SUBJECT_PREFIX_GROUP_B = listOf(
    "документы по заболеванию ", "документы о заболевании ", "документы по болезни ",
    "материалы по заболеванию ", "материалы о заболевании ", "материалы по болезни ",
    "информация по заболеванию ", "информация о заболевании ", "информация по болезни ",
)
private val SUBJECT_PREFIX_VERBS = listOf("", "найти ", "покажи ", "показать ")
private val SUBJECT_PREFIX_VERB_NOUNS = listOf(
    "найти документы", "найти материалы", "покажи документы", "покажи материалы",
    "показать документы", "показать материалы",
)

/** Mirrors `\s*:?\s+` right after a matched verb+noun prefix: optional whitespace, optional colon,
 * then MANDATORY whitespace. Returns the index just past it, or null if it doesn't match there. */
private fun trailingColonAndWhitespace(text: String, start: Int): Int? {
    var i = start
    val n = text.length
    while (i < n && text[i].isWhitespace()) i += 1
    if (i < n && text[i] == ':') i += 1
    val afterColon = i
    while (i < n && text[i].isWhitespace()) i += 1
    return if (i > afterColon) i else null
}

/** Mirrors `searchSubjectText` (normalize.ts): strips a navigation preamble, not words inside a
 * disease name or clinical narrative. */
fun searchSubjectText(value: String): String {
    val normalized = normalizeSurfaceText(value)
    var subject = normalized
    outer@ for (verb in SUBJECT_PREFIX_VERBS) {
        for (rest in SUBJECT_PREFIX_GROUP_A) {
            val prefix = verb + rest
            if (subject.startsWith(prefix)) {
                subject = subject.substring(prefix.length)
                break@outer
            }
        }
        for (rest in SUBJECT_PREFIX_GROUP_B) {
            val prefix = verb + rest
            if (subject.startsWith(prefix)) {
                subject = subject.substring(prefix.length)
                break@outer
            }
        }
    }
    for (verbNoun in SUBJECT_PREFIX_VERB_NOUNS) {
        if (subject.startsWith(verbNoun)) {
            val end = trailingColonAndWhitespace(subject, verbNoun.length)
            if (end != null) subject = subject.substring(end)
            break
        }
    }
    val trimmed = subject.trim()
    return trimmed.ifEmpty { normalized }
}
