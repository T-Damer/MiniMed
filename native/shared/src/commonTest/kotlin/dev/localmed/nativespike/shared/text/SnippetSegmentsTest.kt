package dev.localmed.nativespike.shared.text

import kotlin.test.Test
import kotlin.test.assertEquals

class SnippetSegmentsTest {

    @Test
    fun plain_text_with_no_markers_is_a_single_unhighlighted_segment() {
        assertEquals(
            listOf(SnippetSegment("просто текст без совпадений", highlighted = false)),
            snippetSegments("просто текст без совпадений"),
        )
    }

    @Test
    fun a_single_bracketed_term_splits_into_three_segments() {
        assertEquals(
            listOf(
                SnippetSegment("Острый ", highlighted = false),
                SnippetSegment("менингит", highlighted = true),
                SnippetSegment(" у детей", highlighted = false),
            ),
            snippetSegments("Острый [менингит] у детей"),
        )
    }

    @Test
    fun multiple_highlighted_terms_are_each_their_own_segment() {
        assertEquals(
            listOf(
                SnippetSegment("менингит", highlighted = true),
                SnippetSegment(" или ", highlighted = false),
                SnippetSegment("энцефалит", highlighted = true),
                SnippetSegment(" у ребёнка", highlighted = false),
            ),
            snippetSegments("[менингит] или [энцефалит] у ребёнка"),
        )
    }

    @Test
    fun leading_ellipsis_from_fts5_snippet_is_preserved_as_plain_text() {
        // snippet()'s own ellipsis argument ('…') is just more plain text to this parser.
        val segments = snippetSegments("…контекст перед [термином] и после…")
        assertEquals("…контекст перед ", segments.first().text)
        assertEquals(false, segments.first().highlighted)
        assertEquals("термином", segments[1].text)
        assertEquals(true, segments[1].highlighted)
    }

    @Test
    fun unmatched_opening_bracket_degrades_to_plain_text_instead_of_throwing() {
        val segments = snippetSegments("текст с [незакрытой скобкой")
        assertEquals("текст с ", segments[0].text)
        assertEquals(false, segments[0].highlighted)
        assertEquals("[незакрытой скобкой", segments[1].text)
        assertEquals(false, segments[1].highlighted)
    }

    @Test
    fun empty_string_yields_no_segments() {
        assertEquals(emptyList(), snippetSegments(""))
    }
}
