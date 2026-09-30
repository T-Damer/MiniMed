package dev.localmed.nativespike.shared.reader

import androidx.compose.runtime.Immutable

/**
 * A document ready to read, whatever file it came from: display blocks in source order and the
 * outline built from its headings. Importers only restructure source text for display; they never
 * rewrite or drop it (see docs/NATIVE_READER.md).
 */
@Immutable
data class NativeDocument(val blocks: List<NativeBlock>, val outline: List<NativeOutlineItem>)

/** One heading in the outline; [anchor] is the heading block's anchor. */
@Immutable
data class NativeOutlineItem(val anchor: String, val label: String, val depth: Int)

@Immutable
sealed interface NativeBlock {
    /** A heading; [anchor] follows the web reader (`md-<slug>`, `-2`, `-3` for repeats). */
    data class Heading(val level: Int, val inlines: List<NativeInline>, val anchor: String) : NativeBlock

    data class Paragraph(val inlines: List<NativeInline>) : NativeBlock

    data class ListBlock(val ordered: Boolean, val start: Int, val items: List<NativeListItem>) : NativeBlock

    /** A block quote; [alert] is a GitHub alert kind (`NOTE`, `WARNING`, …) when the quote is one. */
    data class Quote(val blocks: List<NativeBlock>, val alert: String? = null) : NativeBlock

    data class Code(val text: String, val language: String?) : NativeBlock

    /** TeX source shown as written; the reader has no formula typesetter. */
    data class Math(val tex: String) : NativeBlock

    data class Table(val rows: List<NativeTableRow>) : NativeBlock

    /** An image standing alone in its paragraph. */
    data class Image(val source: String, val alt: String, val title: String?) : NativeBlock

    data object Rule : NativeBlock

    /** Source the reader cannot structure (raw HTML in Markdown), kept as plain text. */
    data class Raw(val text: String) : NativeBlock

    /** The start of a source page (PDF text, paged sources). */
    data class PageMark(val page: Int) : NativeBlock
}

@Immutable
data class NativeListItem(val blocks: List<NativeBlock>, val checked: Boolean? = null)

@Immutable
data class NativeTableRow(val cells: List<NativeTableCell>)

@Immutable
data class NativeTableCell(
    val inlines: List<NativeInline>,
    val header: Boolean,
    val align: NativeCellAlign? = null,
    val rowSpan: Int = 1,
    val colSpan: Int = 1,
)

enum class NativeCellAlign { Start, Center, End }

@Immutable
sealed interface NativeInline {
    data class Text(val text: String) : NativeInline
    data class Emphasis(val children: List<NativeInline>) : NativeInline
    data class Strong(val children: List<NativeInline>) : NativeInline
    data class Strike(val children: List<NativeInline>) : NativeInline
    /** `==marked==` text (web `<mark>`). */
    data class Mark(val children: List<NativeInline>) : NativeInline
    data class Code(val text: String) : NativeInline
    data class Math(val tex: String) : NativeInline
    data class Link(val target: String, val children: List<NativeInline>) : NativeInline
    data class Image(val source: String, val alt: String) : NativeInline
    data object LineBreak : NativeInline
}

/** Visible text of inline content, as find and the outline read it. */
fun List<NativeInline>.plainText(): String = buildString { appendPlain(this@plainText) }

private fun StringBuilder.appendPlain(inlines: List<NativeInline>) {
    for (inline in inlines) when (inline) {
        is NativeInline.Text -> append(inline.text)
        is NativeInline.Emphasis -> appendPlain(inline.children)
        is NativeInline.Strong -> appendPlain(inline.children)
        is NativeInline.Strike -> appendPlain(inline.children)
        is NativeInline.Mark -> appendPlain(inline.children)
        is NativeInline.Code -> append(inline.text)
        is NativeInline.Math -> append(inline.tex)
        is NativeInline.Link -> appendPlain(inline.children)
        is NativeInline.Image -> append(inline.alt)
        NativeInline.LineBreak -> append('\n')
    }
}

/** Visible text of a block, as find reads it. */
fun NativeBlock.plainText(): String = when (this) {
    is NativeBlock.Heading -> inlines.plainText()
    is NativeBlock.Paragraph -> inlines.plainText()
    is NativeBlock.ListBlock -> items.joinToString("\n") { item -> item.blocks.joinToString("\n") { it.plainText() } }
    is NativeBlock.Quote -> blocks.joinToString("\n") { it.plainText() }
    is NativeBlock.Code -> text
    is NativeBlock.Math -> tex
    is NativeBlock.Table -> rows.joinToString("\n") { row -> row.cells.joinToString("\t") { it.inlines.plainText() } }
    is NativeBlock.Image -> alt
    NativeBlock.Rule -> ""
    is NativeBlock.Raw -> text
    is NativeBlock.PageMark -> ""
}

/**
 * Heading anchors as the web Markdown reader makes them (`markdown-parser.ts`): lower-cased text
 * without Markdown punctuation, runs of other characters collapsed to `-`, prefixed `md-`, and
 * `-2`, `-3` … for repeated headings.
 */
class NativeAnchorSlugs {
    private val seen = HashMap<String, Int>()

    fun next(label: String): String {
        val base = slugBase(label)
        val count = (seen[base] ?: 0) + 1
        seen[base] = count
        return if (count == 1) "md-$base" else "md-$base-$count"
    }

    private fun slugBase(value: String): String {
        val slug = StringBuilder()
        var pendingDash = false
        for (char in value.lowercase().trim()) {
            if (char in MARKDOWN_PUNCTUATION) continue
            if (char.isLetterOrDigit()) {
                if (pendingDash && slug.isNotEmpty()) slug.append('-')
                pendingDash = false
                slug.append(char)
            } else {
                pendingDash = true
            }
        }
        return slug.toString().ifEmpty { "section" }
    }

    private companion object {
        const val MARKDOWN_PUNCTUATION = "`*_~[]{}()<>"
    }
}
