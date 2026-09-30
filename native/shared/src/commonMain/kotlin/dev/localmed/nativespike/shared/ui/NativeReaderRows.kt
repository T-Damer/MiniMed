package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.core.NativeReaderRoute
import dev.localmed.nativespike.shared.core.NativeSourceChunk
import dev.localmed.nativespike.shared.core.NativeSourceDocument
import dev.localmed.nativespike.shared.reader.NativeBlock
import dev.localmed.nativespike.shared.reader.NativeDocument
import dev.localmed.nativespike.shared.reader.NativeInline
import dev.localmed.nativespike.shared.reader.NativeOutlineItem
import dev.localmed.nativespike.shared.text.nativeSourceReaderBlocks
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

/**
 * An official source laid out for the shared reader: section titles and each chunk's display
 * blocks in source order. [chunks] gives, per block, the original chunk it shows (null for section
 * titles and page marks), so reading positions keep saving exact chunk ids and anchors.
 */
class NativeSourceReaderDocument(val document: NativeDocument, val chunks: List<NativeSourceChunk?>) {
    /** Index of the first block of each chunk, by chunk id. */
    private val firstBlock: Map<String, Int> = buildMap { chunks.forEachIndexed { index, chunk -> if (chunk != null && chunk.id !in this) put(chunk.id, index) } }

    fun firstBlockOf(chunkId: String): Int? = firstBlock[chunkId]

    /** The chunk shown at block [index], or the next chunk after it (a title, a page mark). */
    fun chunkAtOrAfter(index: Int): NativeSourceChunk? = (index.coerceAtLeast(0) until chunks.size).firstNotNullOfOrNull { chunks[it] }
}

fun nativeSourceReaderDocument(source: NativeSourceDocument): NativeSourceReaderDocument {
    val blocks = mutableListOf<NativeBlock>()
    val chunks = mutableListOf<NativeSourceChunk?>()
    val outline = mutableListOf<NativeOutlineItem>()
    var page: Int? = null
    for (section in source.sections.sortedBy { it.orderIndex }) {
        val level = (section.depth + 1).coerceIn(2, 4)
        blocks += NativeBlock.Heading(level, listOf(NativeInline.Text(section.title)), section.anchor)
        chunks += null
        outline += NativeOutlineItem(section.anchor, section.title, level)
        for (chunk in section.chunks.sortedBy { it.orderIndex }) {
            chunk.pageStart?.takeIf { it != page }?.let {
                blocks += NativeBlock.PageMark(it)
                chunks += null
                page = chunk.pageEnd ?: it
            }
            val metadata = SOURCE_JSON.parseToJsonElement(chunk.metadataJson.ifBlank { "{}" }).jsonObject
            // A chunk with no display text still keeps its place, so its anchor stays reachable.
            val display = nativeSourceReaderBlocks(chunk.originalText, metadata).ifEmpty { listOf(NativeBlock.Raw(chunk.originalText)) }
            for (block in display) {
                blocks += block
                chunks += chunk
            }
        }
    }
    return NativeSourceReaderDocument(NativeDocument(blocks, outline), chunks)
}

/**
 * Where to open: the saved chunk wins; otherwise the excerpt's anchor, as a chunk or a section
 * title; otherwise the start.
 */
fun nativeSourceReaderStart(reader: NativeSourceReaderDocument, snapshot: NativeReaderRoute.Document): Int {
    snapshot.chunkId?.let { reader.firstBlockOf(it) }?.let { return it }
    val anchor = snapshot.target.anchor ?: return 0
    reader.chunks.indexOfFirst { it?.anchor == anchor }.takeIf { it >= 0 }?.let { return sectionStart(reader, it) }
    return reader.document.blocks.indexOfFirst { it is NativeBlock.Heading && it.anchor == anchor }.coerceAtLeast(0)
}

/** An excerpt that opens its section starts at the section title, so the title does not cover it. */
private fun sectionStart(reader: NativeSourceReaderDocument, block: Int): Int {
    var index = block - 1
    while (index >= 0 && reader.document.blocks[index] is NativeBlock.PageMark) index--
    return if (index >= 0 && reader.document.blocks[index] is NativeBlock.Heading) index else block
}

private val SOURCE_JSON = Json { ignoreUnknownKeys = true }
