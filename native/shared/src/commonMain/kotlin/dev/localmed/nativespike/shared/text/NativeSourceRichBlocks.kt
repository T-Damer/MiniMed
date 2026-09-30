package dev.localmed.nativespike.shared.text

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

/** Exact prepared-source presentation data; this never changes the original chunk. */
@Serializable
sealed interface NativeSourceRichBlock {
    @Serializable @SerialName("image")
    data class Image(val dataUrl: String, val alt: String, val title: String) : NativeSourceRichBlock
    @Serializable @SerialName("table")
    data class Table(val caption: String, val rows: List<NativeSourceTableRow>) : NativeSourceRichBlock
}

@Serializable
data class NativeSourceTableRow(val cells: List<NativeSourceTableCell>)

@Serializable
data class NativeSourceTableCell(
    val text: String, val header: Boolean, val rowSpan: Int = 1, val colSpan: Int = 1,
    val images: List<NativeSourceRichBlock.Image> = emptyList(), val align: String? = null,
)

internal const val NATIVE_SOURCE_WHITESPACE = "\\u0009-\\u000d \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff"
internal fun String.trimSourceWhitespace(): String = trim {
    it in '\u0009'..'\u000d' || it in '\u2000'..'\u200a' || it in " \u00a0\u1680\u2028\u2029\u202f\u205f\u3000\ufeff"
}
private val safeImage = Regex("^data:image/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=$NATIVE_SOURCE_WHITESPACE]+$")
private val filenameLabel = Regex("^(?:[a-z0-9][a-z0-9._-]*)\\.(?:png|jpe?g|gif|webp|bmp|svg)$", RegexOption.IGNORE_CASE)

internal fun usableSourceImageLabel(value: String): String = value.trimSourceWhitespace().takeUnless { filenameLabel.matches(it) }.orEmpty()

private fun JsonElement?.stringValue(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content
private fun JsonElement?.span(): Int? {
    val number = (this as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull ?: return null
    return number.takeIf { it in 1.0..100.0 && it % 1.0 == 0.0 }?.toInt()
}

private fun sourceImage(value: JsonObject): NativeSourceRichBlock.Image? {
    if (value["kind"].stringValue() != "image") return null
    val dataUrl = value["dataUrl"].stringValue()?.takeIf(safeImage::matches) ?: return null
    return NativeSourceRichBlock.Image(dataUrl,
        usableSourceImageLabel(value["alt"].stringValue().orEmpty()),
        usableSourceImageLabel(value["title"].stringValue().orEmpty()))
}

fun readNativeSourceRichBlock(metadata: JsonObject): NativeSourceRichBlock? {
    val value = metadata["renderBlock"] as? JsonObject ?: return null
    if (value["kind"].stringValue() != "table") return sourceImage(value)
    val rawRows = value["rows"] as? JsonArray ?: return null
    val rows = mutableListOf<NativeSourceTableRow>()
    for (rawRow in rawRows) {
        val rawCells = (rawRow as? JsonObject)?.get("cells") as? JsonArray ?: return null
        val cells = mutableListOf<NativeSourceTableCell>()
        for (rawCell in rawCells) {
            val cell = rawCell as? JsonObject ?: return null
            val text = cell["text"].stringValue() ?: return null
            val rowSpan = cell["rowSpan"].span() ?: return null
            val colSpan = cell["colSpan"].span() ?: return null
            val images = (cell["images"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.let(::sourceImage) }
            cells += NativeSourceTableCell(text, cell["header"] == JsonPrimitive(true), rowSpan, colSpan, images)
        }
        if (cells.isNotEmpty()) rows += NativeSourceTableRow(cells)
    }
    return rows.takeIf { it.isNotEmpty() }?.let { NativeSourceRichBlock.Table(value["caption"].stringValue().orEmpty(), it) }
}

fun NativeSourceRichBlock.searchText(): String = when (this) {
    is NativeSourceRichBlock.Image -> title.ifEmpty { alt }
    is NativeSourceRichBlock.Table -> (listOf(caption).filter(String::isNotEmpty) + rows.flatMap { row -> row.cells.map { it.text } }).joinToString("\n")
}
