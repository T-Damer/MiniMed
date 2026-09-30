package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.core.NativeDocumentTarget
import dev.localmed.nativespike.shared.core.NativeReaderRoute
import dev.localmed.nativespike.shared.core.NativeSourceChunk
import dev.localmed.nativespike.shared.core.NativeSourceDocument
import dev.localmed.nativespike.shared.core.NativeSourceSection
import kotlin.test.Test
import kotlin.test.assertEquals

class NativeReaderRowsTest {
    private val target = NativeDocumentTarget("source", "source-v1", "checksum", "second-chunk")
    private fun chunk(id: String, order: Int, text: String) = NativeSourceChunk(id, id, text, order, "{}", 2, 3, 10, 30)
    private val first = chunk("first-chunk", 0, "Original paragraph\n\n| Column | Value |\n|---|---|\n| Row | 2 |")
    private val second = chunk("second-chunk", 1, "<table><tr><td>Original cell</td></tr></table>")
    private val document = NativeSourceDocument(target, "Source title", "reference", "{}", "v1", null, null,
        listOf(NativeSourceSection("section-two", "Second", "second-section", 1, 1, listOf(second)),
            NativeSourceSection("section-one", "First", "first-section", 1, 0, listOf(first))))

    @Test fun readerPreservesEveryOriginalChunkAndSourceOrder() {
        val rows = nativeReaderRows(document)
        assertEquals(listOf("section-one", "first-chunk", "section-two", "second-chunk"), rows.map { it.key })
        assertEquals(listOf(first.originalText, second.originalText), rows.filterIsInstance<NativeReaderRow.Source>().map { it.chunk.originalText })
        assertEquals(listOf(first, second), rows.filterIsInstance<NativeReaderRow.Source>().map { it.chunk })
    }

    @Test fun excerptUsesExactChunkOrSectionAnchorAndSavedChunkWinsOnRestart() {
        val rows = nativeReaderRows(document)
        assertEquals(3, nativeReaderStartIndex(rows, NativeReaderRoute.Document(target)))
        assertEquals(2, nativeReaderStartIndex(rows, NativeReaderRoute.Document(target.copy(anchor = "second-section"))))
        assertEquals(1, nativeReaderStartIndex(rows, NativeReaderRoute.Document(target, first.id, 42)))
        assertEquals(3, nativeReaderStartIndex(rows, NativeReaderRoute.Document(target, "removed-chunk")))
        assertEquals(0, nativeReaderStartIndex(rows, NativeReaderRoute.Document(target.copy(anchor = "absent-anchor"))))
    }
}
