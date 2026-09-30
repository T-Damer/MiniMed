package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.core.NativeDocumentTarget
import dev.localmed.nativespike.shared.model.DocumentKind
import dev.localmed.nativespike.shared.model.SearchResultGroup
import dev.localmed.nativespike.shared.model.SearchResultItem
import dev.localmed.nativespike.shared.text.TextRange
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class NativeSearchResultCardTest {
    @Test fun snippetsKeepSourceTextUtf16HighlightsAndEachExactEditionAnchor() {
        val target = NativeDocumentTarget("source", "source@2025", "sha256:" + "a".repeat(64), "anchor-1", "module", "2025")
        val text = "🫁 Пневмония [А]"
        val items = listOf(
            SearchResultItem("chunk-1", "section", "Раздел 1", "anchor-1", text, listOf(TextRange(3, 12)), target),
            SearchResultItem("chunk-2", "section", "Раздел 2", "anchor-2", "Полный второй фрагмент", target = target.copy(anchor = "anchor-2")),
        )
        val group = SearchResultGroup("source", "Исходный источник", DocumentKind.CLINICAL_RECOMMENDATION, items)
        val opened = mutableListOf<Pair<String?, NativeDocumentTarget?>>()
        val snippets = nativeResultSnippets(group) { id, title, anchor, edition ->
            assertEquals(group.documentId, id)
            assertEquals(group.documentTitle, title)
            opened += anchor to edition
        }
        assertEquals(text, snippets.first().text)
        assertEquals(listOf(3..11), snippets.first().highlights)
        assertEquals("Пневмония", text.substring(snippets.first().highlights.single()))
        snippets.forEach { it.onOpen() }
        val expected: List<Pair<String?, NativeDocumentTarget?>> = items.map { it.anchor to it.target }
        assertEquals(expected, opened.toList())
        assertFailsWith<IllegalArgumentException> {
            nativeResultSnippets(group.copy(items = listOf(items.first().copy(highlightedRanges = listOf(TextRange(0, text.length + 1)))))) { _, _, _, _ -> }
        }
    }
}
