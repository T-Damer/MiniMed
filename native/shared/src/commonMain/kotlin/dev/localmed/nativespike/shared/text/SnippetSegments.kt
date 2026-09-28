package dev.localmed.nativespike.shared.text

/** One piece of a result snippet: either plain text or a matched-term highlight. */
data class SnippetSegment(val text: String, val highlighted: Boolean)

/**
 * Splits an FTS5 `snippet()` result (produced with `'['`/`']'` as the highlight markers — see
 * `NativeSearchDatabase.sqliteBundled.kt`) into plain/highlighted segments. Pure text logic, kept
 * out of the Compose layer (`SearchScreen.kt`'s `highlightedSnippet` just maps these segments to
 * an `AnnotatedString`) so it is unit-testable without a Compose runtime.
 *
 * An unmatched `[` or `]` (should not happen for a real FTS5 snippet, but input is still just a
 * string) degrades gracefully: the rest of the string from that point is emitted as plain text.
 */
fun snippetSegments(raw: String): List<SnippetSegment> {
    val segments = mutableListOf<SnippetSegment>()
    var index = 0
    while (index < raw.length) {
        val openIndex = raw.indexOf('[', index)
        if (openIndex < 0) {
            segments.add(SnippetSegment(raw.substring(index), highlighted = false))
            break
        }
        if (openIndex > index) {
            segments.add(SnippetSegment(raw.substring(index, openIndex), highlighted = false))
        }
        val closeIndex = raw.indexOf(']', openIndex)
        if (closeIndex < 0) {
            segments.add(SnippetSegment(raw.substring(openIndex), highlighted = false))
            break
        }
        segments.add(SnippetSegment(raw.substring(openIndex + 1, closeIndex), highlighted = true))
        index = closeIndex + 1
    }
    return segments
}
