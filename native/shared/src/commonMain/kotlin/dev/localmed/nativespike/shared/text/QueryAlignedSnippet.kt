package dev.localmed.nativespike.shared.text

/** Mirrors search-lexical/snippet.ts and core's source-listed presentation-row selection. */
data class SnippetResult(val text: String, val ranges: List<TextRange>)

private val htmlOptions = setOf(RegexOption.IGNORE_CASE)
private val entities = mapOf(
    "nbsp" to " ", "amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'",
    "ndash" to "–", "mdash" to "—", "hellip" to "…", "laquo" to "«", "raquo" to "»",
    "deg" to "°", "middot" to "·", "bull" to "•", "times" to "×",
)
private val entityPattern = Regex("&(${entities.keys.joinToString("|")}|#\\d+|#x[0-9a-f]+);", htmlOptions)
private val boldPattern = Regex("<(strong|b)(?:\\s[^<>]*)?>([\\s\\S]*?)</\\1\\s*>", htmlOptions)
private val knownTagPattern = Regex("</?(?:div|span|em|i|strong|b|p|ul|ol|li|details|summary)(?:\\s[^<>]*)?\\s*/?>", htmlOptions)
private val breakPattern = Regex("<br\\s*/?>", htmlOptions)
private val blockClosePattern = Regex("</(?:div|p|ul|ol|li|details|summary)\\s*>", htmlOptions)

/** Strip only authoring HTML, retaining medical comparisons such as <38°C. */
internal fun stripKnownHtmlMarkup(value: String): String {
    var text = breakPattern.replace(value, "\n")
    text = blockClosePattern.replace(text, "\n")
    text = boldPattern.replace(text) { "**${it.groupValues[2]}**" }
    text = knownTagPattern.replace(text, "")
    return entityPattern.replace(text) {
        val name = it.groupValues[1]
        when {
            name.startsWith("#x") -> codePointString(name.substring(2).toInt(16))
            name.startsWith("#") -> codePointString(name.substring(1).toInt())
            else -> entities[name] ?: it.value
        }
    }
}

private fun codePointString(code: Int): String {
    require(code in 0..0x10ffff) { "Invalid HTML entity code point" }
    return if (code <= 0xffff) code.toChar().toString() else {
        val shifted = code - 0x10000
        charArrayOf((0xd800 + (shifted shr 10)).toChar(), (0xdc00 + (shifted and 0x3ff)).toChar()).concatToString()
    }
}

private val knownFieldBefore = Regex("(?:^|[\\s;])(?:тн|торговое\\s+наименование)\\s*:\\s*$", htmlOptions)
private data class Occurrence(val term: String, val start: Int, val end: Int, val knownFieldStart: Int?)

fun buildSnippet(originalText: String, terms: List<String>, maxLength: Int = 360): SnippetResult {
    val readable = stripKnownHtmlMarkup(originalText).replace("**", "")
    val normalized = normalizeSurfaceTextWithOffsets(readable)
    val occurrences = mutableListOf<Occurrence>()
    for (term in terms) {
        val key = normalizeSurfaceText(term)
        if (key.length < 2) continue
        var offset = 0
        while (offset < normalized.text.length) {
            val position = normalized.text.indexOf(key, offset)
            if (position < 0) break
            val start = normalized.offsets[position].start
            val end = normalized.offsets[position + key.length - 1].end
            val before = knownFieldBefore.find(readable.substring(0, start))
            val after = readable.substring(end).trimStart(' ', '\t', '\r')
            val exact = before != null && (after.isEmpty() || after[0] in ".;,\n")
            occurrences.add(Occurrence(key, start, end, if (exact) before!!.range.first else null))
            offset = position + key.length
        }
    }
    val candidates = linkedSetOf(0)
    for (hit in occurrences) {
        candidates.add(maxOf(0, hit.start - maxLength / 3))
        candidates.add(maxOf(0, hit.end - maxLength))
        candidates.add(hit.start)
        hit.knownFieldStart?.let(candidates::add)
    }
    var start = 0
    var bestCount = -1
    var bestExact = -1
    var bestSpan = Int.MAX_VALUE
    for (candidate in candidates) {
        val bounded = minOf(candidate, readable.length)
        val end = minOf(readable.length, bounded + maxLength)
        val inside = occurrences.filter { it.start >= bounded && it.end <= end }
        val count = inside.map { it.term }.toSet().size
        val exact = inside.count { it.knownFieldStart != null }
        val span = if (inside.isEmpty()) Int.MAX_VALUE else inside.maxOf { it.end } - inside.minOf { it.start }
        if (count > bestCount || count == bestCount && (exact > bestExact || exact == bestExact &&
                (span < bestSpan || span == bestSpan && bounded < start))) {
            start = bounded
            bestCount = count
            bestExact = exact
            bestSpan = span
        }
    }
    val end = minOf(readable.length, start + maxLength)
    val prefix = if (start > 0) "…" else ""
    val body = readable.substring(start, end)
    val text = prefix + body + if (end < readable.length) "…" else ""
    val normalizedBody = normalizeSurfaceTextWithOffsets(body)
    val ranges = mutableListOf<TextRange>()
    for (term in terms) {
        val key = normalizeSurfaceText(term)
        if (key.length < 2) continue
        var offset = 0
        while (offset < normalizedBody.text.length) {
            val position = normalizedBody.text.indexOf(key, offset)
            if (position < 0) break
            ranges.add(TextRange(prefix.length + normalizedBody.offsets[position].start,
                prefix.length + normalizedBody.offsets[position + key.length - 1].end))
            offset = position + key.length
        }
    }
    val merged = mutableListOf<TextRange>()
    for (range in ranges.sortedBy { it.start }) {
        val previous = merged.lastOrNull()
        if (previous != null && range.start <= previous.end) {
            merged[merged.lastIndex] = TextRange(previous.start, maxOf(previous.end, range.end))
        } else merged.add(range)
    }
    return SnippetResult(text, merged)
}

private val presentationField = Regex("(?:^|[;\\n])\\s*(?:-\\s*)?(?:тн|торговое\\s+наименование|лекарственная\\s+форма|нормализованные\\s+формы/дозировки)\\s*:\\s*([^.;\\n]+)", htmlOptions)
private val presentationKnownField = Regex("(?:^|[;\\n])\\s*(?:-\\s*)?(?:тн|торговое\\s+наименование)\\s*:\\s*([^.;\\n]+)", htmlOptions)

internal fun presentationRowTerms(originalText: String, terms: List<String>): List<String> {
    val normalizedTerms = terms.map(::normalizeSurfaceText).filter { it.length >= 3 }
    if (normalizedTerms.isEmpty()) return emptyList()
    data class Candidate(val line: String, val matched: Int, val exact: Int)
    val best = originalText.split(Regex("\\r?\\n")).mapNotNull { line ->
        val normalized = normalizeSurfaceText(line)
        val matched = normalizedTerms.filter { normalized.contains(it) }.toSet().size
        val aliases = presentationKnownField.findAll(line).map { normalizeSurfaceText(it.groupValues[1]) }.toList()
        if (!presentationField.containsMatchIn(line) || matched == 0) null
        else Candidate(line, matched, normalizedTerms.count { it in aliases })
    }.sortedWith(compareByDescending<Candidate> { it.exact }.thenByDescending { it.matched }).firstOrNull()
        ?: return emptyList()
    return presentationField.findAll(best.line).map { it.groupValues[1].trim() }.filter { it.isNotEmpty() }.distinct().toList()
}

fun buildQueryAlignedSnippet(originalText: String, terms: List<String>): SnippetResult {
    val rowTerms = presentationRowTerms(originalText, terms)
    return buildSnippet(originalText, terms + rowTerms.filter { it !in terms }, if (rowTerms.isEmpty()) 360 else 520)
}
