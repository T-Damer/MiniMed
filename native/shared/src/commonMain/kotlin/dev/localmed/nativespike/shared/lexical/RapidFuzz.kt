package dev.localmed.nativespike.shared.lexical

/**
 * A Kotlin port of two RapidFuzz (https://github.com/rapidfuzz/RapidFuzz) distance metrics used by
 * `packages/search-lexical/src/rapidfuzz.ts` — Levenshtein and OSA (Optimal String Alignment, aka
 * restricted Damerau-Levenshtein) — ported here as stage 2 sub-stage A of the migration recorded
 * in docs/CURRENT_STATE.md. Distances are unweighted (insert = delete = substitute = transpose =
 * 1), matching `rapidfuzz.distance.Levenshtein`/`rapidfuzz.distance.OSA` at their default weights.
 *
 * RapidFuzz is MIT licensed:
 *   Copyright (c) 2011 Adam Cohen (original fuzzywuzzy), Copyright (c) 2021 Max Bachmann
 *   (RapidFuzz). See NOTICE for the full license text.
 *
 * `extract`/`extractTop` (added in sub-stage B, for `MedicationSpelling.kt`'s RapidFuzz-OSA
 * fallback) are simplified relative to the TS source: they always call `scorer(query, choice)` per
 * pair instead of `resolveFastScorer`'s "prepare the query pattern once, reuse across every choice"
 * fast path. That fast path in rapidfuzz.ts exists purely as a performance optimization for
 * vocabulary-scale choice lists (tens of thousands of comparisons per query) — it selects the
 * *identical* result, just faster, by detecting `scorer === OSA.normalizedSimilarity` via function
 * reference equality (not portable to Kotlin, where `OSA::normalizedSimilarity` creates a new
 * function value each time with no stable identity to compare). Not reimplementing it is a
 * documented perf simplification, not a behavior difference.
 *
 * Two implementations exist for each metric, exactly mirroring the TS source:
 *  - a bit-parallel one (Myers 1999 for Levenshtein; Hyyrö 2003 for OSA), operating on 64-bit
 *    words via Kotlin's `ULong` (which — unlike JS `bigint` — wraps at 64 bits natively, so this
 *    port needs no `u64()` masking helper), used whenever both strings are at most 64 UTF-16 code
 *    units (`Char`s) long;
 *  - a row-wise dynamic-programming fallback (correct for any length), used otherwise and also
 *    used as the correctness oracle the bit-parallel path is checked against in tests.
 *
 * Callers should pass the same normalized strings the rest of MiniMed's search uses (see
 * `text/TextNormalization.kt`'s `normalizeSurfaceText`); nothing here normalizes on its own.
 */

private const val WORD_BITS = 64

/** Bitmask of positions (bit i = character at index i) for every distinct character in `value`. */
private fun buildPeq(value: String): Map<Char, ULong> {
    val peq = HashMap<Char, ULong>()
    for (i in value.indices) {
        val char = value[i]
        peq[char] = (peq[char] ?: 0uL) or (1uL shl i)
    }
    return peq
}

/**
 * A pattern (the shorter, <=64-code-unit side) pre-processed once so it can be compared against
 * many "text" strings without rebuilding its character bitmasks each time. Mirrors `PreparedPattern`.
 */
class PreparedPattern internal constructor(
    val length: Int,
    internal val peq: Map<Char, ULong>,
    internal val vp0: ULong,
    internal val mask: ULong,
)

/** Mirrors `preparePattern`: pre-processes `pattern` (must be <=64 UTF-16 code units). */
fun preparePattern(pattern: String): PreparedPattern {
    val m = pattern.length
    val vp0 = when {
        m == 0 -> 0uL
        m == WORD_BITS -> ULong.MAX_VALUE
        else -> (1uL shl m) - 1uL
    }
    val mask = if (m == 0) 0uL else 1uL shl (m - 1)
    return PreparedPattern(m, buildPeq(pattern), vp0, mask)
}

/** Mirrors `levenshteinBitParallel`/`levenshteinBitParallelPrepared` (Myers 1999). */
private fun levenshteinBitParallel(left: String, right: String): Int =
    levenshteinBitParallelPrepared(preparePattern(left), right)

private fun levenshteinBitParallelPrepared(prepared: PreparedPattern, right: String): Int {
    val m = prepared.length
    if (m == 0) return right.length
    val peq = prepared.peq
    var vp = prepared.vp0
    var vn = 0uL
    var score = m.toLong()
    val mask = prepared.mask
    for (j in right.indices) {
        val eq = peq[right[j]] ?: 0uL
        val xv = eq or vn
        val xh = (((eq and vp) + vp) xor vp) or eq
        var ph = vn or (xh or vp).inv()
        var mh = vp and xh
        if (ph and mask != 0uL) score += 1
        if (mh and mask != 0uL) score -= 1
        ph = (ph shl 1) or 1uL
        mh = mh shl 1
        vp = mh or (xv or ph).inv()
        vn = ph and xv
    }
    return score.toInt()
}

/** Mirrors `levenshteinDp`: row-wise DP, the correctness oracle and fallback for strings over 64 units. */
private fun levenshteinDp(left: String, right: String): Int {
    if (left == right) return 0
    if (left.isEmpty()) return right.length
    if (right.isEmpty()) return left.length
    var previous = IntArray(right.length + 1) { it }
    var current = IntArray(right.length + 1)
    for (i in 1..left.length) {
        current[0] = i
        val leftChar = left[i - 1]
        for (j in 1..right.length) {
            val substitutionCost = if (leftChar == right[j - 1]) 0 else 1
            current[j] = minOf(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + substitutionCost)
        }
        val swap = previous
        previous = current
        current = swap
    }
    return previous[right.length]
}

/** Mirrors `osaBitParallel`/`osaBitParallelPrepared` (Hyyrö 2003). */
private fun osaBitParallel(left: String, right: String): Int =
    osaBitParallelPrepared(preparePattern(left), right)

private fun osaBitParallelPrepared(prepared: PreparedPattern, right: String): Int {
    val m = prepared.length
    if (m == 0) return right.length
    val peq = prepared.peq
    var vp = prepared.vp0
    var vn = 0uL
    var d0 = 0uL
    var peqPreviousChar = 0uL
    var score = m.toLong()
    val mask = prepared.mask
    for (j in right.indices) {
        val peqChar = peq[right[j]] ?: 0uL
        val transposed = ((d0.inv() and peqChar) shl 1) and peqPreviousChar
        var d0h = (((peqChar and vp) + vp) xor vp) or peqChar or vn
        d0h = d0h or transposed
        var ph = vn or (d0h or vp).inv()
        var mh = d0h and vp
        if (ph and mask != 0uL) score += 1
        if (mh and mask != 0uL) score -= 1
        ph = (ph shl 1) or 1uL
        mh = mh shl 1
        vp = mh or (d0h or ph).inv()
        vn = ph and d0h
        d0 = d0h
        peqPreviousChar = peqChar
    }
    return score.toInt()
}

/** Mirrors `osaDp`: row-wise DP, the correctness oracle and fallback for strings over 64 units. */
private fun osaDp(left: String, right: String): Int {
    if (left == right) return 0
    val m = left.length
    val n = right.length
    if (m == 0) return n
    if (n == 0) return m
    var twoBack = IntArray(n + 1)
    var oneBack = IntArray(n + 1) { it }
    var current = IntArray(n + 1)
    for (i in 1..m) {
        current[0] = i
        val leftChar = left[i - 1]
        for (j in 1..n) {
            val substitutionCost = if (leftChar == right[j - 1]) 0 else 1
            var value = minOf(oneBack[j] + 1, current[j - 1] + 1, oneBack[j - 1] + substitutionCost)
            if (i > 1 && j > 1 && leftChar == right[j - 2] && left[i - 2] == right[j - 1]) {
                value = minOf(value, twoBack[j - 2] + 1)
            }
            current[j] = value
        }
        val swap = twoBack
        twoBack = oneBack
        oneBack = current
        current = swap
    }
    return oneBack[n]
}

private fun dispatch(
    left: String,
    right: String,
    bitParallel: (String, String) -> Int,
    dp: (String, String) -> Int,
): Int {
    if (left.length <= WORD_BITS) return bitParallel(left, right)
    if (right.length <= WORD_BITS) return bitParallel(right, left)
    return dp(left, right)
}

private fun normalizedDistanceOf(distance: Int, left: String, right: String): Double {
    val maxLength = maxOf(left.length, right.length)
    if (maxLength == 0) return 0.0
    return distance.toDouble() / maxLength
}

/** Mirrors the `Levenshtein` const object in rapidfuzz.ts. */
object Levenshtein {
    /** Exact edit distance (insert/delete/substitute, each cost 1). */
    fun distance(left: String, right: String): Int = dispatch(left, right, ::levenshteinBitParallel, ::levenshteinDp)

    fun normalizedDistance(left: String, right: String): Double =
        normalizedDistanceOf(distance(left, right), left, right)

    fun similarity(left: String, right: String): Int = maxOf(left.length, right.length) - distance(left, right)

    /** RapidFuzz `normalized_similarity`: `1 - distance / max(len(left), len(right))`, in `[0, 1]`. */
    fun normalizedSimilarity(left: String, right: String): Double = 1 - normalizedDistance(left, right)
}

/** Mirrors the `OSA` const object in rapidfuzz.ts. */
object OSA {
    /** Exact OSA distance (insert/delete/substitute/adjacent-transpose, each cost 1). */
    fun distance(left: String, right: String): Int = dispatch(left, right, ::osaBitParallel, ::osaDp)

    fun normalizedDistance(left: String, right: String): Double =
        normalizedDistanceOf(distance(left, right), left, right)

    fun similarity(left: String, right: String): Int = maxOf(left.length, right.length) - distance(left, right)

    /** RapidFuzz `normalized_similarity`: `1 - distance / max(len(left), len(right))`, in `[0, 1]`. */
    fun normalizedSimilarity(left: String, right: String): Double = 1 - normalizedDistance(left, right)
}

// Aliased with a `Fn` suffix so the `RapidFuzzInternal` object members below can delegate to them
// without shadowing themselves (a member and a top-level function of the same name inside that
// member's own body resolves to itself — infinite recursion, not the top-level one).
private val levenshteinBitParallelFn: (String, String) -> Int = ::levenshteinBitParallel
private val levenshteinDpFn: (String, String) -> Int = ::levenshteinDp
private val osaBitParallelFn: (String, String) -> Int = ::osaBitParallel
private val osaDpFn: (String, String) -> Int = ::osaDp

/** Exposed for the parity test suite — mirrors TS's exported `internal` object with the same intent. */
object RapidFuzzInternal {
    fun levenshteinBitParallel(left: String, right: String): Int = levenshteinBitParallelFn(left, right)
    fun levenshteinDp(left: String, right: String): Int = levenshteinDpFn(left, right)
    fun osaBitParallel(left: String, right: String): Int = osaBitParallelFn(left, right)
    fun osaDp(left: String, right: String): Int = osaDpFn(left, right)
}

/** Mirrors `ExtractMatch<T>`, narrowed to `T = String` (every caller in this port only ever scores
 * plain strings — no `processor` option, unlike the TS source's generic `ExtractMatch<T>`). */
data class ExtractMatch(val choice: String, val score: Double, val index: Int)

/**
 * Mirrors `extract`: scores every choice, drops anything below `scoreCutoff`, returns the rest
 * sorted by descending score (ties broken by original index, for determinism). Default scorer is
 * `OSA.normalizedSimilarity`, matching the TS default.
 */
fun extract(
    query: String,
    choices: List<String>,
    scorer: (String, String) -> Double = { a, b -> OSA.normalizedSimilarity(a, b) },
    scoreCutoff: Double = 0.0,
    limit: Int? = null,
): List<ExtractMatch> {
    val matches = mutableListOf<ExtractMatch>()
    for ((index, choice) in choices.withIndex()) {
        val value = scorer(query, choice)
        if (value >= scoreCutoff) matches.add(ExtractMatch(choice, value, index))
    }
    matches.sortWith(compareByDescending<ExtractMatch> { it.score }.thenBy { it.index })
    return if (limit == null) matches else matches.take(limit)
}

/**
 * Mirrors `extractTop`: same selection semantics as `extract` with a `limit` — top-`limit` by
 * score desc/index asc, filtered by `scoreCutoff`. The TS source keeps a bounded min-heap instead
 * of sorting everything, an O(n log k) optimization for large vocabularies with small `limit`; this
 * port sorts then slices (see this file's header for why that's a deliberate, behavior-preserving
 * simplification here, not a shortcut that changes results).
 */
fun extractTop(
    query: String,
    choices: List<String>,
    limit: Int,
    scorer: (String, String) -> Double = { a, b -> OSA.normalizedSimilarity(a, b) },
    scoreCutoff: Double = 0.0,
): List<ExtractMatch> {
    if (limit <= 0) return emptyList()
    return extract(query, choices, scorer, scoreCutoff, limit)
}
