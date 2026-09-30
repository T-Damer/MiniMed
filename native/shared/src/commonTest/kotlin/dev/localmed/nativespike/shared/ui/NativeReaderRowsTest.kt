package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.core.NativeDocumentTarget
import dev.localmed.nativespike.shared.core.NativeReaderRoute
import dev.localmed.nativespike.shared.core.NativeSourceChunk
import dev.localmed.nativespike.shared.core.NativeSourceDocument
import dev.localmed.nativespike.shared.core.NativeSourceSection
import dev.localmed.nativespike.shared.reader.NativeBlock
import dev.localmed.nativespike.shared.reader.plainText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class NativeReaderRowsTest {
    private val target = NativeDocumentTarget("source", "source-v1", "checksum", "second-chunk")
    private fun chunk(id: String, order: Int, text: String, page: Int = 2) = NativeSourceChunk(id, id, text, order, "{}", page, page, 10, 30)
    private val first = chunk("first-chunk", 0, "Original paragraph\n\n| Column | Value |\n|---|---|\n| Row | 2 |")
    private val second = chunk("second-chunk", 1, "<table><tr><td>Original cell</td></tr></table>", page = 3)
    private val document = NativeSourceDocument(target, "Source title", "reference", "{}", "v1", null, null,
        listOf(NativeSourceSection("section-two", "Second", "second-section", 1, 1, listOf(second)),
            NativeSourceSection("section-one", "First", "first-section", 1, 0, listOf(first))))

    @Test fun readerShowsEveryChunkInSourceOrderAndKeepsItsOrigin() {
        val reader = nativeSourceReaderDocument(document)
        val blocks = reader.document.blocks
        assertEquals(NativeBlock.Heading(2, listOf(dev.localmed.nativespike.shared.reader.NativeInline.Text("First")), "first-section"), blocks[0])
        assertEquals(NativeBlock.PageMark(2), blocks[1])
        assertEquals(listOf("first-section", "second-section"), reader.document.outline.map { it.anchor })
        // Every chunk contributes blocks, all tied back to that exact chunk, in order.
        assertEquals(listOf("first-chunk", "second-chunk"), reader.chunks.filterNotNull().map { it.id }.distinct())
        assertTrue(blocks.zip(reader.chunks).filter { it.second == first }.joinToString(" ") { it.first.plainText() }.contains("Original paragraph"))
        assertTrue(blocks.zip(reader.chunks).filter { it.second == second }.joinToString(" ") { it.first.plainText() }.contains("Original cell"))
        assertTrue(NativeBlock.PageMark(3) in blocks)
    }

    @Test fun startUsesSavedChunkThenExcerptAnchorThenSectionTitle() {
        val reader = nativeSourceReaderDocument(document)
        val secondStart = reader.firstBlockOf("second-chunk")!!
        val secondTitle = reader.document.blocks.indexOfFirst { it is NativeBlock.Heading && it.anchor == "second-section" }
        // The excerpt opens its section: the reader starts at the section title above it.
        assertEquals(secondTitle, nativeSourceReaderStart(reader, NativeReaderRoute.Document(target)))
        assertEquals(secondTitle, nativeSourceReaderStart(reader, NativeReaderRoute.Document(target.copy(anchor = "second-section"))))
        assertEquals(reader.firstBlockOf("first-chunk"), nativeSourceReaderStart(reader, NativeReaderRoute.Document(target, first.id, 42)))
        assertEquals(secondTitle, nativeSourceReaderStart(reader, NativeReaderRoute.Document(target, "removed-chunk")))
        assertEquals(secondStart, nativeSourceReaderStart(reader, NativeReaderRoute.Document(target, "second-chunk")))
        assertEquals(0, nativeSourceReaderStart(reader, NativeReaderRoute.Document(target.copy(anchor = "absent-anchor"))))
        assertEquals(first, reader.chunkAtOrAfter(0))
    }
}
