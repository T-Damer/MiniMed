package dev.localmed.nativespike.shared.reader

import com.fleeksoft.ksoup.Ksoup
import com.fleeksoft.ksoup.nodes.Element
import com.fleeksoft.ksoup.nodes.Node
import com.fleeksoft.ksoup.nodes.TextNode

/**
 * HTML (and EPUB XHTML) to [NativeDocument]. Only content survives: scripts, styles, forms, frames
 * and embedded media are dropped, nothing is loaded, CSS is not applied. Unknown elements keep
 * their text. A heading's anchor is its `id` when it has one (so `#id` links work), otherwise the
 * web Markdown slug.
 */
object NativeHtmlImporter {
    /** The parsed document and the page `<title>`, if any. */
    fun import(html: String): Pair<NativeDocument, String?> {
        val page = Ksoup.parse(html)
        val builder = Builder()
        val blocks = builder.blocks(page.body())
        return NativeDocument(blocks, builder.outline) to page.title().trim().ifEmpty { null }
    }

    private class Builder {
        val outline = mutableListOf<NativeOutlineItem>()
        private val slugs = NativeAnchorSlugs()

        fun blocks(parent: Element): List<NativeBlock> {
            val out = mutableListOf<NativeBlock>()
            val pending = mutableListOf<NativeInline>()
            fun flush() {
                val inlines = pending.normalized()
                pending.clear()
                if (inlines.isEmpty()) return
                val only = inlines.singleOrNull()
                out += if (only is NativeInline.Image) NativeBlock.Image(only.source, only.alt, null) else NativeBlock.Paragraph(inlines)
            }
            for (child in parent.childNodes()) {
                if (child !is Element) {
                    inline(child, pending)
                    continue
                }
                when (val name = child.normalName()) {
                    in DROPPED -> Unit
                    "h1", "h2", "h3", "h4", "h5", "h6" -> {
                        flush()
                        val inlines = inlines(child)
                        val label = inlines.plainText().trim()
                        if (label.isNotEmpty()) {
                            val anchor = child.id().ifBlank { slugs.next(label) }
                            outline += NativeOutlineItem(anchor, label, name[1].digitToInt())
                            out += NativeBlock.Heading(name[1].digitToInt(), inlines, anchor)
                        }
                    }
                    "p" -> {
                        flush()
                        pending += inline(child)
                        flush()
                    }
                    "ul", "ol", "menu" -> {
                        flush()
                        list(child)?.let { out += it }
                    }
                    "blockquote" -> {
                        flush()
                        blocks(child).takeIf { it.isNotEmpty() }?.let { out += NativeBlock.Quote(it) }
                    }
                    "pre" -> {
                        flush()
                        val language = (child.selectFirst("code")?.className().orEmpty() + " " + child.className())
                            .split(' ').firstOrNull { it.startsWith("language-") }?.removePrefix("language-")
                        out += NativeBlock.Code(child.wholeText().trimEnd('\n').removePrefix("\n"), language)
                    }
                    "table" -> {
                        flush()
                        table(child)?.let { out += it }
                    }
                    "hr" -> {
                        flush()
                        out += NativeBlock.Rule
                    }
                    "figure" -> {
                        flush()
                        val image = child.selectFirst("img")
                        val caption = child.selectFirst("figcaption")?.text()?.trim()?.ifEmpty { null }
                        if (image != null && image.attr("src").isNotBlank()) {
                            out += NativeBlock.Image(image.attr("src"), image.attr("alt"), caption)
                        } else {
                            out += blocks(child)
                        }
                    }
                    in BLOCK_CONTAINERS -> {
                        flush()
                        out += blocks(child)
                    }
                    else -> inline(child, pending)
                }
            }
            flush()
            return out
        }

        private fun list(element: Element): NativeBlock.ListBlock? {
            val ordered = element.normalName() == "ol"
            val items = element.children().filter { it.normalName() == "li" }.map { item -> NativeListItem(blocks(item)) }
            if (items.isEmpty()) return null
            return NativeBlock.ListBlock(ordered, element.attr("start").toIntOrNull() ?: 1, items)
        }

        private fun table(element: Element): NativeBlock.Table? {
            val rows = element.select("tr").filter { row -> row.parents().firstOrNull { it.normalName() == "table" } == element }
            val tableRows = rows.map { row ->
                NativeTableRow(
                    row.children().filter { it.normalName() == "td" || it.normalName() == "th" }.map { cell ->
                        val align = (cell.attr("align") + " " + cell.attr("style")).lowercase()
                        NativeTableCell(
                            inlines = inline(cell).normalized(),
                            header = cell.normalName() == "th",
                            align = when {
                                "center" in align -> NativeCellAlign.Center
                                "right" in align -> NativeCellAlign.End
                                "left" in align -> NativeCellAlign.Start
                                else -> null
                            },
                            rowSpan = cell.attr("rowspan").toIntOrNull()?.coerceIn(1, 64) ?: 1,
                            colSpan = cell.attr("colspan").toIntOrNull()?.coerceIn(1, 64) ?: 1,
                        )
                    },
                )
            }.filter { it.cells.isNotEmpty() }
            return tableRows.takeIf { it.isNotEmpty() }?.let(NativeBlock::Table)
        }

        private fun inlines(element: Element): List<NativeInline> = inline(element).normalized()

        /** The inline content of [element]'s children. */
        private fun inline(element: Element): List<NativeInline> {
            val out = mutableListOf<NativeInline>()
            for (child in element.childNodes()) inline(child, out)
            return out
        }

        private fun inline(node: Node, out: MutableList<NativeInline>) {
            if (node is TextNode) {
                out += NativeInline.Text(node.getWholeText())
                return
            }
            if (node !is Element) return
            when (node.normalName()) {
                in DROPPED -> Unit
                "br" -> out += NativeInline.LineBreak
                "em", "i", "cite", "dfn", "var" -> out += NativeInline.Emphasis(inline(node))
                "strong", "b" -> out += NativeInline.Strong(inline(node))
                "s", "del", "strike" -> out += NativeInline.Strike(inline(node))
                "mark" -> out += NativeInline.Mark(inline(node))
                "code", "kbd", "samp", "tt" -> out += NativeInline.Code(node.wholeText())
                "a" -> {
                    val href = node.attr("href").trim()
                    // An anchor without a usable address is plain text; scripts never run.
                    if (href.isEmpty() || href.startsWith("javascript:", ignoreCase = true)) out += inline(node)
                    else out += NativeInline.Link(href, inline(node))
                }
                "img" -> {
                    val source = node.attr("src").trim()
                    if (source.isNotEmpty()) out += NativeInline.Image(source, node.attr("alt"))
                }
                else -> out += inline(node)
            }
        }
    }

    /** HTML whitespace rules: runs collapse to one space; block edges and line starts trim. */
    private fun List<NativeInline>.normalized(): List<NativeInline> {
        val out = mutableListOf<NativeInline>()
        var lastSpace = true
        fun walk(items: List<NativeInline>): List<NativeInline> {
            val result = mutableListOf<NativeInline>()
            for (item in items) when (item) {
                is NativeInline.Text -> {
                    val collapsed = buildString {
                        for (char in item.text) {
                            if (char.isWhitespace()) {
                                if (!lastSpace) append(' ')
                                lastSpace = true
                            } else {
                                append(char)
                                lastSpace = false
                            }
                        }
                    }
                    if (collapsed.isNotEmpty()) result += NativeInline.Text(collapsed)
                }
                NativeInline.LineBreak -> {
                    (result.lastOrNull() as? NativeInline.Text)?.let { result[result.lastIndex] = NativeInline.Text(it.text.trimEnd()) }
                    result += item
                    lastSpace = true
                }
                is NativeInline.Emphasis -> result += NativeInline.Emphasis(walk(item.children))
                is NativeInline.Strong -> result += NativeInline.Strong(walk(item.children))
                is NativeInline.Strike -> result += NativeInline.Strike(walk(item.children))
                is NativeInline.Mark -> result += NativeInline.Mark(walk(item.children))
                is NativeInline.Link -> result += NativeInline.Link(item.target, walk(item.children))
                else -> {
                    result += item
                    lastSpace = false
                }
            }
            return result
        }
        out += walk(this)
        // Drop the trailing space of the block and empty wrappers.
        (out.lastOrNull() as? NativeInline.Text)?.let { last ->
            val trimmed = last.text.trimEnd()
            if (trimmed.isEmpty()) out.removeAt(out.lastIndex) else out[out.lastIndex] = NativeInline.Text(trimmed)
        }
        return out.filterNot { it is NativeInline.Text && it.text.isEmpty() }.mergedText()
    }

    private fun List<NativeInline>.mergedText(): List<NativeInline> {
        val out = mutableListOf<NativeInline>()
        for (inline in this) {
            val previous = out.lastOrNull()
            if (inline is NativeInline.Text && previous is NativeInline.Text) out[out.lastIndex] = NativeInline.Text(previous.text + inline.text)
            else out += inline
        }
        return out
    }

    /** Elements whose content is never shown: code, styling, forms, frames and media. */
    private val DROPPED = setOf(
        "script", "style", "noscript", "template", "iframe", "frame", "frameset", "object", "embed", "applet",
        "form", "input", "button", "select", "textarea", "option", "svg", "canvas", "audio", "video", "source",
        "track", "map", "area", "link", "meta", "head", "title", "base", "dialog",
    )

    /** Elements that only group blocks. */
    private val BLOCK_CONTAINERS = setOf(
        "body", "div", "section", "article", "main", "header", "footer", "aside", "nav", "address", "center",
        "details", "summary", "dl", "dt", "dd", "figcaption", "hgroup", "fieldset", "legend", "caption",
        "html", "li", "tbody", "thead", "tfoot",
    )
}
