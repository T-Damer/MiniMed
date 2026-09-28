package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.text.tokenize

/**
 * A Kotlin port of `ICD10_CODE_PATTERN` and its consumers — `icd10ChapterLetter`,
 * `icd10LegacyFtsQueries`, `icd10CodeFragments`, `icd10SearchTerms`
 * (packages/search-lexical/src/analysis.ts) — stage 2 sub-stage B of the migration recorded in
 * docs/CURRENT_STATE.md. Implemented as a manual scanner, not `Regex`: the TS pattern combines a
 * fixed-width negative lookbehind, a named group, Cyrillic character-class ranges and
 * case-insensitive matching, all flagged as risky on Kotlin/Native by this project's own prior
 * experience (see `text/TextNormalization.kt`'s header on Cyrillic character-class ranges in
 * Kotlin/Native `Regex`, found the hard way on `iosSimulatorArm64Test`).
 *
 * Ported against `analysis.ts`'s current version, which as of commit b516c222 ("fix(search): keep
 * the typed ICD chapter in the legacy code fallback") derives the FTS chapter letter from the
 * query itself (`icd10ChapterLetter`) instead of always guessing the hardcoded "i" — regenerating
 * `search-golden.json` against that commit changed only the header (`generatedAt`/`commit`), no
 * query content, confirming none of the 142 fixture queries exercise a letter-bearing ICD code
 * where the old hardcoded "i" fallback would have differed from this new logic.
 */

// ICD-10 chapters use Latin letters; Cyrillic look-alikes typed on a Russian layout map back.
private val CYRILLIC_ICD_LETTERS: Map<Char, Char> = mapOf(
    'а' to 'a', 'в' to 'b', 'с' to 'c', 'е' to 'e', 'н' to 'h', 'к' to 'k',
    'м' to 'm', 'о' to 'o', 'р' to 'p', 'т' to 't', 'х' to 'x',
)

/** Mirrors `icd10ChapterLetter`. `compact` is always already lowercased by `findIcd10Matches`. */
fun icd10ChapterLetter(compact: String): Char? {
    val first = compact.getOrNull(0) ?: return null
    if (first in 'a'..'z') return first
    return CYRILLIC_ICD_LETTERS[first]
}

/**
 * One `ICD10_CODE_PATTERN` match. `raw` is the full matched substring (fed to `tokenize()` by
 * `icd10CodeFragments`); `compact` is the separator/whitespace-stripped, lowercased code — mirrors
 * `match.groups.code.replace(/[.\-\s]/gu, '').toLowerCase()`, computed once here since every TS
 * caller does it immediately after matching.
 */
data class Icd10Match(val raw: String, val compact: String)

private fun isIcd10Letter(c: Char): Boolean = c in 'a'..'z' || c in 'A'..'Z' || c in 'А'..'я'
private fun isIcd10Digit(c: Char): Boolean = c in '0'..'9'
private fun isIcd10BoundaryChar(c: Char): Boolean = isIcd10Letter(c) || isIcd10Digit(c)
private fun isIcd10SeparatorChar(c: Char): Boolean = c == '.' || c == '-' || c.isWhitespace()

/**
 * Mirrors `value.matchAll(ICD10_CODE_PATTERN)`: non-overlapping, left-to-right, same scan order as
 * JS's global regex. At each candidate start position: an optional single letter (any case, Latin
 * or Cyrillic — the TS pattern has the `i` flag) immediately followed by exactly two digits, then
 * an optional continuation — either one separator (`.`/`-`/whitespace) plus optional extra
 * whitespace plus one-or-more digits, or plain one-or-more digits directly — and finally a
 * boundary check (not immediately preceded/followed by a letter or digit).
 */
fun findIcd10Matches(value: String): List<Icd10Match> {
    val matches = mutableListOf<Icd10Match>()
    val n = value.length
    var i = 0
    while (i < n) {
        if (i > 0 && isIcd10BoundaryChar(value[i - 1])) {
            i += 1
            continue
        }
        val hasLetter = isIcd10Letter(value[i]) &&
            i + 2 < n && isIcd10Digit(value[i + 1]) && isIcd10Digit(value[i + 2])
        val digitsStart = if (hasLetter) i + 1 else i
        val hasBareDigits = !hasLetter &&
            digitsStart + 1 < n && isIcd10Digit(value[digitsStart]) && isIcd10Digit(value[digitsStart + 1])
        if (!hasLetter && !hasBareDigits) {
            i += 1
            continue
        }
        var end = digitsStart + 2
        if (end < n && isIcd10SeparatorChar(value[end])) {
            var afterSeparator = end + 1
            while (afterSeparator < n && value[afterSeparator].isWhitespace()) afterSeparator += 1
            if (afterSeparator < n && isIcd10Digit(value[afterSeparator])) {
                var digitsEnd = afterSeparator
                while (digitsEnd < n && isIcd10Digit(value[digitsEnd])) digitsEnd += 1
                end = digitsEnd
            }
            // else: separator not followed by digits — the optional continuation group simply
            // does not match (mirrors the regex backtracking to zero-width), `end` stays put.
        } else {
            while (end < n && isIcd10Digit(value[end])) end += 1
        }
        if (end < n && isIcd10BoundaryChar(value[end])) {
            i += 1
            continue
        }
        val raw = value.substring(i, end)
        val compact = raw.filterNot { isIcd10SeparatorChar(it) }.lowercase()
        matches.add(Icd10Match(raw, compact))
        i = end
    }
    return matches
}

/** Mirrors `icd10LegacyFtsQueries` (current, post-b516c222 version — see file header). */
fun icd10LegacyFtsQueries(value: String, excludedNumericTerms: Set<String>? = null): List<String> {
    val queries = LinkedHashSet<String>()
    for (match in findIcd10Matches(value)) {
        val compact = match.compact
        val numeric = icd10NumericPart(compact)
        if (numeric.length < 3 || excludedNumericTerms?.contains(numeric) == true) continue
        val prefix = numeric.substring(0, 2)
        val suffix = numeric.substring(2)
        val chapter = icd10ChapterLetter(compact)
        if (chapter != null) {
            // The typed chapter is authoritative: «F23.3» must never fall back to I23.3. Pointers
            // that index only the three-character code («f23») still surface the parent category.
            queries.add("(${ftsToken("$chapter$prefix")} AND ${ftsToken(suffix)})")
            queries.add(ftsToken("$chapter$prefix"))
            continue
        }
        // A bare number («67.9») is read as the cardiology chapter the legacy pilot indexed.
        queries.add("(${ftsToken(prefix)} AND ${ftsToken(suffix)})")
        queries.add("(${ftsToken("i$prefix")} AND ${ftsToken(suffix)})")
    }
    return queries.toList()
}

/** Mirrors `compact?.replace(/^[a-zа-я]/u, '')`: strip one leading letter, if present. `compact` is
 * always lowercase already (see `Icd10Match`). */
private fun icd10NumericPart(compact: String): String {
    val first = compact.getOrNull(0) ?: return compact
    return if (first in 'a'..'z' || first in 'а'..'я') compact.substring(1) else compact
}

/** Mirrors `icd10CodeFragments`. */
fun icd10CodeFragments(values: List<String>): Set<String> {
    val fragments = LinkedHashSet<String>()
    for (value in values) {
        for (match in findIcd10Matches(value)) {
            for (token in tokenize(match.raw)) fragments.add(token)
        }
    }
    return fragments
}

/** Mirrors `icd10SearchTerms`. */
fun icd10SearchTerms(values: List<String>): List<String> {
    val terms = LinkedHashSet<String>()
    for (value in values) {
        for (match in findIcd10Matches(value)) {
            val compact = match.compact
            if (compact.length < 3) continue
            terms.add(compact)
            val numeric = icd10NumericPart(compact)
            if (numeric.length >= 3) terms.add(numeric)
        }
    }
    return terms.toList()
}
