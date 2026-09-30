package dev.localmed.nativespike.shared.text

import dev.localmed.nativespike.shared.reader.*
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable
sealed interface NativeSourceTextBlock {
    @Serializable @SerialName("paragraph") data class Paragraph(val text: String) : NativeSourceTextBlock
    @Serializable @SerialName("bullet") data class Bullet(val text: String) : NativeSourceTextBlock
    @Serializable @SerialName("ordered") data class Ordered(val text: String, val ordinal: Long) : NativeSourceTextBlock
    @Serializable @SerialName("image") data class Image(val alt: String, val source: String) : NativeSourceTextBlock
    @Serializable @SerialName("table") data class Table(val text: String, val table: NativeSourceRichBlock.Table) : NativeSourceTextBlock
}

private val paragraphs = Regex("\\r?\\n(?:[$NATIVE_SOURCE_WHITESPACE]*\\r?\\n)+")
private val markers = Regex("[$NATIVE_SOURCE_WHITESPACE]*([•▪◦●○])[$NATIVE_SOURCE_WHITESPACE]*")
private val bullet = Regex("^[•▪◦●○*+-][$NATIVE_SOURCE_WHITESPACE]+(.+)$")
private val ordered = Regex("^(\\d+)[.)][$NATIVE_SOURCE_WHITESPACE]+(.+)$")
private val image = Regex("^!\\[([^\\]]*)\\]\\((https?://[^$NATIVE_SOURCE_WHITESPACE)]+)\\)$")
private val imageSource = Regex("^\\[Источник изображения\\]\\((https?://[^$NATIVE_SOURCE_WHITESPACE)]+)\\)$")
private val lower = Regex("^\\p{Ll}")
private data class SourceLine(val sourceIndex: Int, val text: String)

/** Mirrors Web parseDocumentText; original source and source-span indexing remain untouched. */
fun parseNativeSourceText(value: String, sourceSpans: JsonElement? = null): List<NativeSourceTextBlock> {
    val tables = nativeSourceTables(value)
    if (tables.isNotEmpty()) {
        val result = mutableListOf<NativeSourceTextBlock>()
        var cursor = 0
        fun prose(start: Int, end: Int) = parseNativeSourceText(value.substring(start, end),
            (sourceSpans as? JsonArray)?.let { JsonArray(it.drop(paragraphs.split(value.substring(0, start)).size - 1)) } ?: sourceSpans)
        for (node in tables) {
            result += prose(cursor, node.start)
            val table = node.table
            result += NativeSourceTextBlock.Table(table.searchText(), table)
            cursor = node.end
        }
        result += prose(cursor, value.length)
        return result
    }
    val lines = paragraphs.split(value).flatMapIndexed { sourceIndex, part ->
        markers.replace(part.trimSourceWhitespace()) { "\n${it.groupValues[1]} " }.split('\n').map { SourceLine(sourceIndex, it.trimSourceWhitespace()) }
    }
    val implicit = mutableSetOf<Int>()
    for (index in 1 until lines.size) {
        if (!lines[index - 1].text.endsWith(':') && !lines[index - 1].text.endsWith('：')) continue
        var end = index
        while (end < lines.size && lower.containsMatchIn(lines[end].text) && lines[end].text.lastOrNull() in listOf('.', ';')) end++
        if (end - index >= 2 && lines[end - 1].text.endsWith('.')) implicit += index until end
    }
    fun left(index: Int): Double? = (((sourceSpans as? JsonArray)?.getOrNull(index) as? JsonObject)?.get("bbox") as? JsonArray)
        ?.firstOrNull()?.let { (it as? JsonPrimitive)?.takeUnless { p -> p.isString }?.doubleOrNull }
    val blocks = mutableListOf<NativeSourceTextBlock>()
    var indent: Double? = null
    var previousIndex: Int? = null
    for ((index, line) in lines.withIndex()) {
        if (line.text.isEmpty()) continue
        val picture = image.matchEntire(line.text)
        if (picture != null) {
            blocks += NativeSourceTextBlock.Image(picture.groupValues[1].trimSourceWhitespace(), picture.groupValues[2])
            indent = null; previousIndex = line.sourceIndex; continue
        }
        val credit = imageSource.matchEntire(line.text)
        if (credit != null && (blocks.lastOrNull() as? NativeSourceTextBlock.Image)?.source == credit.groupValues[1]) {
            previousIndex = line.sourceIndex; continue
        }
        val marked = bullet.matchEntire(line.text)
        val numbered = ordered.matchEntire(line.text)
        if (marked != null || numbered != null || index in implicit) {
            blocks += when {
                marked != null -> NativeSourceTextBlock.Bullet(marked.groupValues[1])
                numbered != null -> NativeSourceTextBlock.Ordered(numbered.groupValues[2], numbered.groupValues[1].toLongOrNull() ?: return listOf(NativeSourceTextBlock.Paragraph(value)))
                else -> NativeSourceTextBlock.Bullet(line.text)
            }
            indent = left(line.sourceIndex); previousIndex = line.sourceIndex; continue
        }
        val previous = blocks.lastOrNull()
        val currentLeft = left(line.sourceIndex)
        val continues = (previous is NativeSourceTextBlock.Bullet || previous is NativeSourceTextBlock.Ordered) &&
            (indent == null || currentLeft == null || currentLeft > indent + 4)
        when {
            continues && previous is NativeSourceTextBlock.Bullet -> blocks[blocks.lastIndex] = previous.copy(text = "${previous.text} ${line.text}")
            continues && previous is NativeSourceTextBlock.Ordered -> blocks[blocks.lastIndex] = previous.copy(text = "${previous.text} ${line.text}")
            previous is NativeSourceTextBlock.Paragraph && previous.text.lastOrNull() !in listOf('.', '!', '?', ';', ':') &&
                currentLeft != null && previousIndex != null && kotlin.math.abs(currentLeft - (left(previousIndex) ?: currentLeft)) < 4 ->
                blocks[blocks.lastIndex] = previous.copy(text = "${previous.text} ${line.text}")
            else -> { blocks += NativeSourceTextBlock.Paragraph(line.text); indent = null }
        }
        previousIndex = line.sourceIndex
    }
    return blocks
}

/** Shared reader blocks contain display text; callers retain the exact chunk and its anchor. */
fun nativeSourceReaderBlocks(originalText: String, metadata: JsonObject): List<NativeBlock> {
    fun paragraph(text: String) = NativeBlock.Paragraph(listOf(NativeInline.Text(text)))
    fun rich(block: NativeSourceRichBlock): List<NativeBlock> = when (block) {
        is NativeSourceRichBlock.Image -> listOf(NativeBlock.Image(block.dataUrl, block.alt, block.title))
        is NativeSourceRichBlock.Table -> listOfNotNull(block.caption.takeIf(String::isNotEmpty)?.let(::paragraph)) + NativeBlock.Table(block.rows.map { row ->
            NativeTableRow(row.cells.map { cell -> NativeTableCell(listOf(NativeInline.Text(cell.text)) + cell.images.map { NativeInline.Image(it.dataUrl, it.alt) },
                cell.header, when (cell.align) { "left" -> NativeCellAlign.Start; "center" -> NativeCellAlign.Center; "right" -> NativeCellAlign.End; else -> null }, cell.rowSpan, cell.colSpan) })
        })
    }
    readNativeSourceRichBlock(metadata)?.let { return rich(it) }
    val result = mutableListOf<NativeBlock>()
    var previousKind: String? = null
    for (block in parseNativeSourceText(stripKnownHtmlMarkup(originalText), metadata["sourceSpans"])) {
        val kind = when (block) { is NativeSourceTextBlock.Bullet -> "bullet"; is NativeSourceTextBlock.Ordered -> "ordered"; else -> null }
        val text = when (block) {
            is NativeSourceTextBlock.Paragraph -> block.text
            is NativeSourceTextBlock.Bullet -> block.text
            is NativeSourceTextBlock.Ordered -> block.text
            else -> null
        }?.replace("**", "")
        val item = text?.let { NativeListItem(listOf(paragraph(it))) }
        if (kind != null && kind == previousKind && result.lastOrNull() is NativeBlock.ListBlock) {
            val previous = result.last() as NativeBlock.ListBlock
            result[result.lastIndex] = previous.copy(items = previous.items + requireNotNull(item))
        } else when (block) {
            is NativeSourceTextBlock.Paragraph -> result += paragraph(requireNotNull(text))
            is NativeSourceTextBlock.Bullet -> result += NativeBlock.ListBlock(false, 1, listOf(requireNotNull(item)))
            is NativeSourceTextBlock.Ordered -> {
                // ponytail: reader start is Int; keep larger ordinals literally until its model widens.
                result += if (block.ordinal in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong())
                    NativeBlock.ListBlock(true, block.ordinal.toInt(), listOf(requireNotNull(item)))
                    else NativeBlock.Raw("${block.ordinal}. $text")
            }
            is NativeSourceTextBlock.Image -> result += NativeBlock.Image(block.source, block.alt.replace("**", ""), null)
            is NativeSourceTextBlock.Table -> result += rich(block.table)
        }
        previousKind = kind
    }
    return result
}
