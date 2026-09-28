package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.AliasRecord
import dev.localmed.nativespike.shared.text.normalizeSurfaceText
import kotlin.math.abs
import kotlin.math.round

/**
 * A Kotlin port of `packages/search-lexical/src/medication-spelling.ts` — a corpus-vocabulary
 * typo-correction fallback for medication names, part of stage 2 sub-stage B (the coordinator
 * explicitly asked for it since the public `buildLookupQueryPlan` — `medication-lookup.ts` — always
 * runs it; see `MedicationLookupPlan.kt`). Structure and naming stay close to the TS source.
 *
 * NOT ported without approximation: the `NAME`/`NEGATION`/`PREFIX`/`SUFFIX` regexes are implemented
 * as manual scanners rather than `Regex`, for the same Kotlin/Native Cyrillic-character-class/
 * lookaround caution documented throughout this port (see `text/TextNormalization.kt`'s header).
 * `PREFIX`'s optional-group backtracking and `SUFFIX`'s multi-alternative lookahead are hand-traced
 * against the original regex semantics — see each helper's own comment.
 */

// 2026-09-24 RapidFuzz OSA medication-name experiment (docs/research/rapidfuzz-medication-experiment-2026-09-24.md):
// swept 0.65-0.90; 0.65 and 0.70 tied for best recall. Only reached when the weighted-OSA matcher
// above finds nothing.
private const val RAPIDFUZZ_FALLBACK_CUTOFF = 0.65
private const val RAPIDFUZZ_FALLBACK_LIMIT = 12

// Search costs, not equivalence classes or clinically interchangeable medicine names. и/о is not
// inferred transitively from и/е and е/о.
private val CONFUSIONS = listOf("ие", "ео", "ао", "дт", "зс", "жш", "бп", "вф", "гк", "шщ", "ий", "еэ")
private val PAIRS: Set<String> = CONFUSIONS.flatMap { listOf(it, it.reversed()) }.toSet()
private const val MAX_NAME = 96
const val MAX_MEDICATION_SPELLING_MATCHES = 8

private val NEGATION_WORDS = setOf("не", "нет", "без", "отрицает", "аллергия", "аллергии")
private val SUFFIX_SINGLE_KEYWORDS =
    listOf("мг", "мл", "mg", "ml", "таблетки", "капсулы", "раствор", "инструкция", "дозировка", "противопоказания")

private data class Distance(val cost: Int, val edits: Int)

/** Weighted optimal-string-alignment distance with an independent edit-count ceiling. Mirrors
 * `tokenDistance`. */
private fun tokenDistance(left: String, right: String): Distance? {
    if (left == right) return Distance(0, 0)
    if (minOf(left.length, right.length) < 5 || maxOf(left.length, right.length) > 48) return null
    val maximum = if (minOf(left.length, right.length) < 7) 1 else if (left.length >= 10) 3 else 2
    if (abs(left.length - right.length) > maximum) return null
    val budget = if (maximum == 1) 3 else if (maximum == 2) 5 else 6
    var previous = IntArray(right.length + 1) { it * 3 }
    var previousEdits = IntArray(right.length + 1) { it }
    var beforePrevious = previous
    var beforePreviousEdits = previousEdits
    for (i in 1..left.length) {
        val current = IntArray(right.length + 1) { 1000 }
        val currentEdits = IntArray(right.length + 1) { 1000 }
        current[0] = i * 3
        currentEdits[0] = i
        val from = maxOf(1, i - maximum)
        val to = minOf(right.length, i + maximum)
        for (j in from..to) {
            val same = left[i - 1] == right[j - 1]
            val substitution = if (same) 0 else if (PAIRS.contains("${left[i - 1]}${right[j - 1]}")) 1 else 3
            var cost = minOf(previous[j] + 3, current[j - 1] + 3, previous[j - 1] + substitution)
            var edits = minOf(previousEdits[j] + 1, currentEdits[j - 1] + 1, previousEdits[j - 1] + if (same) 0 else 1)
            if (i > 1 && j > 1 && left[i - 1] == right[j - 2] && left[i - 2] == right[j - 1]) {
                cost = minOf(cost, beforePrevious[j - 2] + 2)
                edits = minOf(edits, beforePreviousEdits[j - 2] + 1)
            }
            current[j] = cost
            currentEdits[j] = edits
        }
        beforePrevious = previous
        beforePreviousEdits = previousEdits
        previous = current
        previousEdits = currentEdits
    }
    val cost = previous[right.length]
    val edits = previousEdits[right.length]
    return if (cost <= budget && edits <= maximum) Distance(cost, edits) else null
}

/** Mirrors `letterMask`/`bitCount`: a safe lower bound (at most 3 edits can change at most 6
 * distinct letters). */
private fun letterMask(value: String): Int {
    var bits = 0
    for (c in value) bits = bits or (1 shl (c.code % 32))
    return bits
}

private fun bitCount(value: Int): Int {
    var bits = value
    var count = 0
    while (bits != 0) {
        bits = bits and (bits - 1)
        count += 1
    }
    return count
}

private fun isAllCyrillicWord(s: String): Boolean = s.isNotEmpty() && s.all { it in 'а'..'я' }
private fun isAllLatinWord(s: String): Boolean = s.isNotEmpty() && s.all { it in 'a'..'z' }

/** Mirrors the `NAME` regex: 1-4 words separated by single spaces/hyphens, either all-Cyrillic or
 * all-Latin, never mixed. Manual scan, not `Regex` (see file header). */
private fun isNameShaped(value: String): Boolean {
    val words = splitWordsOnly(value) ?: return false
    if (words.size !in 1..4) return false
    if (words.all { isAllCyrillicWord(it) }) return true
    return words.all { isAllLatinWord(it) }
}

/** Splits on space/hyphen, discarding the delimiters; `null` if any word would be empty (leading,
 * trailing, or doubled delimiter) — mirrors the regex never matching those shapes. */
private fun splitWordsOnly(value: String): List<String>? {
    if (value.isEmpty()) return null
    val words = mutableListOf<String>()
    val current = StringBuilder()
    for (c in value) {
        if (c == ' ' || c == '-') {
            if (current.isEmpty()) return null
            words.add(current.toString())
            current.clear()
        } else {
            current.append(c)
        }
    }
    if (current.isEmpty()) return null
    words.add(current.toString())
    return words
}

/** Mirrors `lookup.split(/([ -])/u)`: keeps delimiters as their own elements (odd indices),
 * matching JS `String.split` with a capturing-group regex, including empty elements for
 * leading/trailing/doubled delimiters. */
private fun splitKeepingDelimiters(value: String): List<String> {
    val result = mutableListOf<String>()
    val current = StringBuilder()
    for (c in value) {
        if (c == ' ' || c == '-') {
            result.add(current.toString())
            current.clear()
            result.add(c.toString())
        } else {
            current.append(c)
        }
    }
    result.add(current.toString())
    return result
}

/** Mirrors the whole-string regex `^(?:([а-я]{7,48})[ -]([а-я])|([a-z]{7,48})[ -]([a-z]))$` — exactly
 * one delimiter, a 7-48-letter same-script stem before it, a single same-script letter after it. */
private fun extractStemAndMarker(normalized: String): Pair<String, Char>? {
    var delimPos = -1
    for (i in normalized.indices) {
        if (normalized[i] == ' ' || normalized[i] == '-') {
            if (delimPos >= 0) return null
            delimPos = i
        }
    }
    if (delimPos < 0) return null
    val stem = normalized.substring(0, delimPos)
    val markerPart = normalized.substring(delimPos + 1)
    if (markerPart.length != 1 || stem.length !in 7..48) return null
    val marker = markerPart[0]
    val stemIsCyrillic = stem.all { it in 'а'..'я' }
    val stemIsLatin = !stemIsCyrillic && stem.all { it in 'a'..'z' }
    if (!stemIsCyrillic && !stemIsLatin) return null
    val markerOk = if (stemIsCyrillic) marker in 'а'..'я' else marker in 'a'..'z'
    return if (markerOk) stem to marker else null
}

/** Mirrors `NEGATION.test(normalized)`: any of these words appears as a whole whitespace-delimited
 * token. */
private fun containsNegationWord(normalized: String): Boolean {
    var start = 0
    val n = normalized.length
    while (start < n) {
        while (start < n && normalized[start].isWhitespace()) start += 1
        var end = start
        while (end < n && !normalized[end].isWhitespace()) end += 1
        if (end > start && normalized.substring(start, end) in NEGATION_WORDS) return true
        start = end
    }
    return false
}

/**
 * Mirrors `PREFIX.exec(normalized)?.[0] ?? ''` — the regex's greedy-optional-group-then-backtrack
 * behavior hand-traced: "инструкция" first tries consuming `\s+(?:к|по)`, and only if that whole
 * sub-match (including a MANDATORY trailing `\s+` after it) fails does it fall back to just
 * "инструкция" + mandatory `\s+`. Returns the matched prefix length (0 if PREFIX does not match at
 * all — the string does not start with one of these words followed by whitespace).
 */
private fun findPrefixLength(normalized: String): Int {
    val n = normalized.length
    if (normalized.startsWith("инструкция")) {
        val pos = "инструкция".length
        if (pos < n && normalized[pos] == ' ') {
            val afterSpace = pos + 1
            if (normalized.regionMatches(afterSpace, "к", 0, 1)) {
                val afterK = afterSpace + 1
                if (afterK < n && normalized[afterK] == ' ') return afterK + 1
            }
            if (normalized.regionMatches(afterSpace, "по", 0, 2)) {
                val afterPo = afterSpace + 2
                if (afterPo < n && normalized[afterPo] == ' ') return afterPo + 1
            }
            return pos + 1 // fall back: "инструкция" + mandatory whitespace, no chapter word
        }
        return 0
    }
    for (word in listOf("препарат", "лекарство", "описание")) {
        if (normalized.startsWith(word)) {
            val pos = word.length
            if (pos < n && normalized[pos] == ' ') return pos + 1
        }
    }
    return 0
}

/**
 * Mirrors `SUFFIX.exec(remainder)?.index ?? remainder.length` — the leftmost single space whose
 * lookahead is a digit, one of the single-word keywords followed by whitespace-or-end, or the
 * two-word phrase "побочные эффекты" followed by whitespace-or-end. Assumes `remainder` only ever
 * has single-space runs (guaranteed by `normalizeSurfaceText`'s own whitespace collapsing), so this
 * scans for single `' '` positions rather than `\s+` runs.
 */
private fun findSuffixIndex(remainder: String): Int {
    val n = remainder.length
    for (i in remainder.indices) {
        if (remainder[i] != ' ') continue
        val j = i + 1
        if (j >= n) continue
        if (remainder[j] in '0'..'9') return i
        for (keyword in SUFFIX_SINGLE_KEYWORDS) {
            if (remainder.regionMatches(j, keyword, 0, keyword.length)) {
                val after = j + keyword.length
                if (after == n || remainder[after] == ' ') return i
            }
        }
        if (remainder.regionMatches(j, "побочные", 0, "побочные".length)) {
            val afterWord = j + "побочные".length
            if (afterWord < n && remainder[afterWord] == ' ') {
                val k = afterWord + 1
                if (remainder.regionMatches(k, "эффекты", 0, "эффекты".length)) {
                    val after = k + "эффекты".length
                    if (after == n || remainder[after] == ' ') return i
                }
            }
        }
    }
    return n
}

/** Mirrors `MedicationSpellingMatch`. */
data class MedicationSpellingMatch(
    val name: String,
    val canonicalTerms: List<String>,
    val matchedText: String,
    val replacementQuery: String,
    val cost: Int,
    /** Missing source-labelled marker is a navigation ambiguity, not a synonym. */
    val omittedSuffix: Char?,
)

private class MedName(
    val name: String,
    val normalized: String,
    val fullNormalized: String,
    val omittedSuffix: Char?,
    val parts: List<String>,
    val masks: List<Int>,
    val canonicals: MutableSet<String>,
)

fun interface MedicationSpellingMatcher {
    fun match(query: String): List<MedicationSpellingMatch>
}

/**
 * Mirrors `createMedicationSpellingMatcher`: a compact index of the already-loaded medication
 * alias vocabulary, not document bodies. Exact known names are never repaired. No first-letter
 * filter — the first letter can be wrong. Clinical analysis does not invoke this; it belongs to
 * ordinary source lookup only.
 */
fun createMedicationSpellingMatcher(aliases: List<AliasRecord>): MedicationSpellingMatcher {
    val known = HashSet<String>()
    val names = LinkedHashMap<String, MedName>()
    fun add(value: String, canonical: String, lookup: String, suffix: Char?) {
        val fullNormalized = normalizeSurfaceText(value)
        val key = "$fullNormalized\u0000$lookup"
        val existing = names[key]
        if (existing != null) {
            existing.canonicals.add(canonical)
        } else {
            val parts = splitKeepingDelimiters(lookup)
            names[key] = MedName(
                name = value,
                normalized = lookup,
                fullNormalized = fullNormalized,
                omittedSuffix = suffix,
                parts = parts,
                masks = parts.map { letterMask(it) },
                canonicals = mutableSetOf(canonical),
            )
        }
    }
    for (alias in aliases) {
        for (value in listOf(alias.alias, alias.canonicalTerm)) {
            val normalized = normalizeSurfaceText(value)
            known.add(normalized)
            if (alias.category != "medication" || normalized.length > MAX_NAME || !isNameShaped(normalized)) continue
            add(value, alias.canonicalTerm, normalized, null)
            // Project only a substantial one-word name with one *existing* letter marker. Do not
            // erase Forte/Retard, numbers, manufacturers or an explicitly entered marker. Both
            // "Foo Н" and "Foo П" remain distinct alternatives with their full source names.
            val stemMarker = extractStemAndMarker(normalized)
            if (stemMarker != null) add(value, alias.canonicalTerm, stemMarker.first, stemMarker.second)
        }
    }
    val lengths = HashMap<Int, MutableList<MedName>>()
    val byLookup = LinkedHashMap<String, MutableList<MedName>>()
    for (name in names.values) {
        lengths.getOrPut(name.normalized.length) { mutableListOf() }.add(name)
        byLookup.getOrPut(name.normalized) { mutableListOf() }.add(name)
    }
    val rapidfuzzChoices = byLookup.keys.toList()

    return MedicationSpellingMatcher matcher@{ query ->
        if (query.isEmpty() || query.length > 160 || '\u0000' in query) return@matcher emptyList()
        val normalized = normalizeSurfaceText(query)
        if (known.contains(normalized) || containsNegationWord(normalized)) return@matcher emptyList()
        val prefixLength = findPrefixLength(normalized)
        val prefix = normalized.substring(0, prefixLength)
        val remainder = normalized.substring(prefixLength)
        val suffixIndex = findSuffixIndex(remainder)
        val subject = remainder.substring(0, suffixIndex)
        if (subject.isEmpty() || subject.length > MAX_NAME || !isNameShaped(subject) || known.contains(subject)) {
            return@matcher emptyList()
        }
        val parts = splitKeepingDelimiters(subject)
        val masks = parts.map { letterMask(it) }
        val matches = mutableListOf<MedicationSpellingMatch>()
        for (length in maxOf(5, subject.length - 3)..(subject.length + 3)) {
            for (name in lengths[length].orEmpty()) {
                if (name.parts.size != parts.size) continue
                var cost = 0
                var edits = 0
                var valid = true
                for (i in parts.indices) {
                    val left = parts[i]
                    val right = name.parts.getOrElse(i) { "" }
                    if (i % 2 == 1) {
                        if (left != right) {
                            valid = false
                            break
                        }
                        continue
                    }
                    if (bitCount(masks.getOrElse(i) { 0 } xor name.masks.getOrElse(i) { 0 }) > 6) {
                        valid = false
                        break
                    }
                    val distance = tokenDistance(left, right)
                    if (distance == null) {
                        valid = false
                        break
                    }
                    cost += distance.cost
                    edits += distance.edits
                    if (cost > 6 || edits > 3) {
                        valid = false
                        break
                    }
                }
                if (valid && (cost > 0 || name.omittedSuffix != null)) {
                    matches.add(
                        MedicationSpellingMatch(
                            name = name.name,
                            canonicalTerms = name.canonicals.toList().sorted().take(8),
                            matchedText = subject,
                            replacementQuery = prefix + name.fullNormalized + remainder.substring(suffixIndex),
                            cost = cost + if (name.omittedSuffix != null) 1 else 0,
                            omittedSuffix = name.omittedSuffix,
                        ),
                    )
                }
            }
        }
        // RapidFuzz OSA fallback: only when the primary weighted-OSA matcher above found nothing,
        // and only for a single bare word (no space/hyphen) — the same scope the marker projection
        // above is built for.
        if (matches.isEmpty() && parts.size == 1) {
            val candidates = extractTop(
                subject, rapidfuzzChoices, RAPIDFUZZ_FALLBACK_LIMIT, scoreCutoff = RAPIDFUZZ_FALLBACK_CUTOFF,
            )
            for (candidate in candidates) {
                for (name in byLookup[candidate.choice].orEmpty()) {
                    matches.add(
                        MedicationSpellingMatch(
                            name = name.name,
                            canonicalTerms = name.canonicals.toList().sorted().take(8),
                            matchedText = subject,
                            replacementQuery = prefix + name.fullNormalized + remainder.substring(suffixIndex),
                            // Not the same cost scale as the weighted-OSA matcher above (that one
                            // counts edits; this is a RapidFuzz normalized_similarity in
                            // [cutoff, 1]) — only used to rank fallback candidates against each
                            // other, always ranked below any primary match.
                            cost = round((1 - candidate.score) * 20).toInt(),
                            omittedSuffix = name.omittedSuffix,
                        ),
                    )
                }
            }
        }
        matches
            .sortedWith(compareBy<MedicationSpellingMatch> { it.cost }.thenComparator { a, b -> localeCompareApprox(a.name, b.name) })
            .take(MAX_MEDICATION_SPELLING_MATCHES)
    }
}
