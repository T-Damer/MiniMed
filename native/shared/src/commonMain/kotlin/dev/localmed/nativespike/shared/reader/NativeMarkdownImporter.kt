package dev.localmed.nativespike.shared.reader

import org.intellij.markdown.IElementType
import org.intellij.markdown.MarkdownElementTypes
import org.intellij.markdown.MarkdownTokenTypes
import org.intellij.markdown.ast.ASTNode
import org.intellij.markdown.flavours.gfm.GFMElementTypes
import org.intellij.markdown.flavours.gfm.GFMFlavourDescriptor
import org.intellij.markdown.flavours.gfm.GFMTokenTypes
import org.intellij.markdown.html.entities.Entities
import org.intellij.markdown.parser.MarkdownParser

/**
 * Markdown (CommonMark + GFM tables, task lists, strikethrough, `==mark==`, `$math$`, alerts) to
 * [NativeDocument], as the web reader's remark pipeline shows it. Raw HTML is not interpreted: a
 * `<br>` breaks the line, other tags are dropped and their text kept; HTML blocks stay as text.
 */
object NativeMarkdownImporter {
    fun import(markdown: String): NativeDocument {
        val root = MarkdownParser(GFMFlavourDescriptor(), assertionsEnabled = false).buildMarkdownTreeFromString(markdown as CharSequence)
        val builder = Builder(markdown, linkDefinitions(root, markdown))
        val blocks = builder.blocks(root.children)
        return NativeDocument(blocks, builder.outline)
    }

    private class Builder(private val source: String, private val links: Map<String, String>) {
        val outline = mutableListOf<NativeOutlineItem>()
        private val slugs = NativeAnchorSlugs()

        fun blocks(nodes: List<ASTNode>): List<NativeBlock> = nodes.mapNotNull(::block)

        private fun block(node: ASTNode): NativeBlock? = when (node.type) {
            MarkdownElementTypes.ATX_1, MarkdownElementTypes.ATX_2, MarkdownElementTypes.ATX_3,
            MarkdownElementTypes.ATX_4, MarkdownElementTypes.ATX_5, MarkdownElementTypes.ATX_6,
            -> heading(ATX_LEVELS.getValue(node.type), node.children.firstOrNull { it.type == MarkdownTokenTypes.ATX_CONTENT })
            MarkdownElementTypes.SETEXT_1 -> heading(1, node.children.firstOrNull { it.type == MarkdownTokenTypes.SETEXT_CONTENT })
            MarkdownElementTypes.SETEXT_2 -> heading(2, node.children.firstOrNull { it.type == MarkdownTokenTypes.SETEXT_CONTENT })
            MarkdownElementTypes.PARAGRAPH -> paragraph(node)
            MarkdownElementTypes.UNORDERED_LIST -> list(node, ordered = false)
            MarkdownElementTypes.ORDERED_LIST -> list(node, ordered = true)
            MarkdownElementTypes.BLOCK_QUOTE -> NativeBlock.Quote(blocks(node.children))
            GFMElementTypes.ALERT -> NativeBlock.Quote(
                blocks(node.children.filter { it.type != GFMTokenTypes.ALERT_TITLE }),
                alert = node.children.firstOrNull { it.type == GFMTokenTypes.ALERT_TITLE }
                    ?.let { text(it).trim().removePrefix("[!").removeSuffix("]").uppercase() },
            )
            MarkdownElementTypes.CODE_FENCE -> fence(node)
            MarkdownElementTypes.CODE_BLOCK -> NativeBlock.Code(
                node.children.filter { it.type == MarkdownTokenTypes.CODE_LINE || it.type == MarkdownTokenTypes.EOL }
                    .joinToString("") { if (it.type == MarkdownTokenTypes.EOL) "\n" else text(it).removeIndent(4) }
                    .trimEnd('\n'),
                language = null,
            )
            GFMElementTypes.BLOCK_MATH -> NativeBlock.Math(between(node, GFMTokenTypes.DOLLAR).trim())
            GFMElementTypes.TABLE -> table(node)
            MarkdownTokenTypes.HORIZONTAL_RULE -> NativeBlock.Rule
            MarkdownElementTypes.HTML_BLOCK -> text(node).stripTags().takeIf { it.isNotBlank() }?.let { NativeBlock.Raw(it.trim()) }
            else -> null
        }

        private fun heading(level: Int, content: ASTNode?): NativeBlock.Heading {
            val inlines = content?.let { inlines(it.children) }.orEmpty().trimmed()
            val label = inlines.plainText().trim()
            val anchor = slugs.next(label)
            outline += NativeOutlineItem(anchor, label, level)
            return NativeBlock.Heading(level, inlines, anchor)
        }

        private fun paragraph(node: ASTNode): NativeBlock {
            // `$$…$$` is parsed inline; alone in its paragraph it is display math.
            val content = node.children.filter { it.type != MarkdownTokenTypes.EOL && it.type != MarkdownTokenTypes.WHITE_SPACE }
            content.singleOrNull()?.takeIf { it.type == GFMElementTypes.BLOCK_MATH }?.let { return NativeBlock.Math(between(it, GFMTokenTypes.DOLLAR).trim()) }
            val inlines = inlines(node.children).trimmed()
            val only = inlines.singleOrNull()
            return if (only is NativeInline.Image) NativeBlock.Image(only.source, only.alt, imageTitle(node)) else NativeBlock.Paragraph(inlines)
        }

        private fun imageTitle(paragraph: ASTNode): String? = paragraph.children
            .firstOrNull { it.type == MarkdownElementTypes.IMAGE }
            ?.children?.firstOrNull { it.type == MarkdownElementTypes.INLINE_LINK }
            ?.children?.firstOrNull { it.type == MarkdownElementTypes.LINK_TITLE }
            ?.let { unescape(text(it).drop(1).dropLast(1)) }

        private fun list(node: ASTNode, ordered: Boolean): NativeBlock.ListBlock {
            val items = node.children.filter { it.type == MarkdownElementTypes.LIST_ITEM }
            val start = items.firstOrNull()?.children?.firstOrNull { it.type == MarkdownTokenTypes.LIST_NUMBER }
                ?.let { text(it).takeWhile(Char::isDigit).toIntOrNull() } ?: 1
            return NativeBlock.ListBlock(
                ordered = ordered,
                start = start,
                items = items.map { item ->
                    val box = item.children.firstOrNull { it.type == GFMTokenTypes.CHECK_BOX }
                    NativeListItem(blocks(item.children), checked = box?.let { text(it).contains('x', ignoreCase = true) })
                },
            )
        }

        private fun fence(node: ASTNode): NativeBlock.Code {
            val content = node.children.filter { it.type == MarkdownTokenTypes.CODE_FENCE_CONTENT }
            val code = if (content.isEmpty()) "" else source.substring(content.first().startOffset, content.last().endOffset)
            val language = node.children.firstOrNull { it.type == MarkdownTokenTypes.FENCE_LANG }?.let { text(it).trim() }
            return NativeBlock.Code(code, language?.ifEmpty { null })
        }

        private fun table(node: ASTNode): NativeBlock.Table {
            val separator = node.children.firstOrNull { it.type == GFMTokenTypes.TABLE_SEPARATOR }?.let(::text).orEmpty()
            val aligns = separator.trim().trim('|').split('|').map { column ->
                val spec = column.trim()
                when {
                    spec.startsWith(':') && spec.endsWith(':') -> NativeCellAlign.Center
                    spec.endsWith(':') -> NativeCellAlign.End
                    spec.startsWith(':') -> NativeCellAlign.Start
                    else -> null
                }
            }
            val rows = node.children.filter { it.type == GFMElementTypes.HEADER || it.type == GFMElementTypes.ROW }.map { row ->
                val header = row.type == GFMElementTypes.HEADER
                NativeTableRow(
                    row.children.filter { it.type == GFMTokenTypes.CELL }.mapIndexed { column, cell ->
                        NativeTableCell(inlines(cell.children).trimmed(), header, aligns.getOrNull(column))
                    },
                )
            }
            return NativeBlock.Table(rows)
        }

        fun inlines(nodes: List<ASTNode>): List<NativeInline> {
            val out = mutableListOf<NativeInline>()
            for (node in nodes) inline(node, out)
            return out.merged()
        }

        private fun inline(node: ASTNode, out: MutableList<NativeInline>) {
            when (node.type) {
                MarkdownElementTypes.EMPH -> out += NativeInline.Emphasis(inlines(inner(node, MarkdownTokenTypes.EMPH)))
                MarkdownElementTypes.STRONG -> out += NativeInline.Strong(inlines(inner(node, MarkdownTokenTypes.EMPH)))
                GFMElementTypes.STRIKETHROUGH -> out += NativeInline.Strike(inlines(inner(node, GFMTokenTypes.TILDE)))
                GFMElementTypes.HIGHLIGHT -> out += NativeInline.Mark(inlines(inner(node, GFMTokenTypes.EQUALS)))
                MarkdownElementTypes.CODE_SPAN -> out += NativeInline.Code(codeSpan(between(node, MarkdownTokenTypes.BACKTICK)))
                GFMElementTypes.INLINE_MATH, GFMElementTypes.BLOCK_MATH -> out += NativeInline.Math(between(node, GFMTokenTypes.DOLLAR).trim())
                MarkdownElementTypes.INLINE_LINK, MarkdownElementTypes.FULL_REFERENCE_LINK, MarkdownElementTypes.SHORT_REFERENCE_LINK,
                -> out += link(node) ?: NativeInline.Text(text(node))
                MarkdownElementTypes.AUTOLINK -> {
                    val url = node.children.firstOrNull { it.type == MarkdownTokenTypes.AUTOLINK || it.type == MarkdownTokenTypes.EMAIL_AUTOLINK }
                        ?.let(::text).orEmpty()
                    val target = if (url.contains('@') && !url.contains(':')) "mailto:$url" else url
                    out += NativeInline.Link(target, listOf(NativeInline.Text(url)))
                }
                GFMTokenTypes.GFM_AUTOLINK -> {
                    val url = text(node)
                    out += NativeInline.Link(if (url.startsWith("www.")) "https://$url" else url, listOf(NativeInline.Text(url)))
                }
                MarkdownElementTypes.IMAGE -> {
                    val link = node.children.firstOrNull { it.type != MarkdownTokenTypes.EXCLAMATION_MARK }
                    val resolved = link?.let(::link)
                    out += if (resolved != null) NativeInline.Image(resolved.target, resolved.children.plainText()) else NativeInline.Text(text(node))
                }
                MarkdownTokenTypes.EOL -> out += NativeInline.Text(" ")
                MarkdownTokenTypes.HARD_LINE_BREAK -> out += NativeInline.LineBreak
                MarkdownTokenTypes.HTML_TAG -> if (BREAK_TAG.matches(text(node))) out += NativeInline.LineBreak
                MarkdownTokenTypes.ESCAPED_BACKTICKS -> out += NativeInline.Text(text(node).replace("\\", ""))
                GFMTokenTypes.CHECK_BOX -> Unit
                else -> if (node.children.isEmpty()) out += NativeInline.Text(unescape(text(node))) else node.children.forEach { inline(it, out) }
            }
        }

        private fun link(node: ASTNode): NativeInline.Link? {
            val label = node.children.firstOrNull { it.type == MarkdownElementTypes.LINK_LABEL }
            val textNode = node.children.firstOrNull { it.type == MarkdownElementTypes.LINK_TEXT } ?: label
            val target = when (node.type) {
                MarkdownElementTypes.INLINE_LINK -> node.children.firstOrNull { it.type == MarkdownElementTypes.LINK_DESTINATION }
                    ?.let { unescape(text(it).removeSurrounding("<", ">")) }.orEmpty()
                else -> label?.let { links[normalizeLabel(text(it))] } ?: return null
            }
            val children = textNode?.children.orEmpty().filter { it.type != MarkdownTokenTypes.LBRACKET && it.type != MarkdownTokenTypes.RBRACKET }
            return NativeInline.Link(target, inlines(children).trimmed())
        }

        private fun inner(node: ASTNode, delimiter: IElementType): List<ASTNode> =
            node.children.dropWhile { it.type == delimiter }.dropLastWhile { it.type == delimiter }

        private fun between(node: ASTNode, delimiter: IElementType): String {
            val inner = inner(node, delimiter)
            return if (inner.isEmpty()) "" else source.substring(inner.first().startOffset, inner.last().endOffset)
        }

        private fun text(node: ASTNode): String = source.substring(node.startOffset, node.endOffset)
    }

    private fun linkDefinitions(root: ASTNode, source: String): Map<String, String> {
        val map = HashMap<String, String>()
        fun visit(node: ASTNode) {
            if (node.type == MarkdownElementTypes.LINK_DEFINITION) {
                val label = node.children.firstOrNull { it.type == MarkdownElementTypes.LINK_LABEL } ?: return
                val destination = node.children.firstOrNull { it.type == MarkdownElementTypes.LINK_DESTINATION } ?: return
                map.getOrPut(normalizeLabel(source.substring(label.startOffset, label.endOffset))) {
                    unescape(source.substring(destination.startOffset, destination.endOffset).removeSurrounding("<", ">"))
                }
            } else {
                node.children.forEach(::visit)
            }
        }
        visit(root)
        return map
    }

    private fun normalizeLabel(label: String): String =
        label.removeSurrounding("[", "]").trim().split(WHITESPACE).joinToString(" ").lowercase()

    /** CommonMark code span content: line ends become spaces; one space each side is stripped. */
    private fun codeSpan(raw: String): String {
        val text = raw.replace('\n', ' ')
        return if (text.length >= 2 && text.startsWith(' ') && text.endsWith(' ') && text.isNotBlank()) text.substring(1, text.length - 1) else text
    }

    /** Resolves backslash escapes and character references to the characters they stand for. */
    internal fun unescape(text: String): String {
        if ('\\' !in text && '&' !in text) return text
        return ESCAPE_OR_ENTITY.replace(text) { match ->
            val escaped = match.groups[1]
            val named = match.groups[2]
            val decimal = match.groups[3]
            val hex = match.groups[4]
            when {
                escaped != null -> escaped.value
                named != null -> Entities.map["&${named.value};"]?.let(::codePoint) ?: match.value
                decimal != null -> decimal.value.toIntOrNull()?.let(::codePoint) ?: match.value
                hex != null -> hex.value.toIntOrNull(16)?.let(::codePoint) ?: match.value
                else -> match.value
            }
        }
    }

    private fun codePoint(code: Int): String = when {
        code == 0 || code > 0x10FFFF -> "\uFFFD"
        code < 0x10000 -> code.toChar().toString()
        else -> {
            val offset = code - 0x10000
            charArrayOf((0xD800 + (offset shr 10)).toChar(), (0xDC00 + (offset and 0x3FF)).toChar()).concatToString()
        }
    }

    private fun String.removeIndent(width: Int): String {
        var drop = 0
        while (drop < width && drop < length && this[drop] == ' ') drop++
        return substring(drop)
    }

    private fun String.stripTags(): String = unescape(TAG.replace(COMMENT.replace(this, ""), ""))

    /** Drops soft-break spaces at the edges of a block's inline content. */
    private fun List<NativeInline>.trimmed(): List<NativeInline> {
        if (isEmpty()) return this
        val list = toMutableList()
        (list.first() as? NativeInline.Text)?.let { first ->
            val trimmed = first.text.trimStart()
            if (trimmed.isEmpty()) list.removeAt(0) else list[0] = NativeInline.Text(trimmed)
        }
        (list.lastOrNull() as? NativeInline.Text)?.let { last ->
            val trimmed = last.text.trimEnd()
            if (trimmed.isEmpty()) list.removeAt(list.lastIndex) else list[list.lastIndex] = NativeInline.Text(trimmed)
        }
        return list
    }

    private fun List<NativeInline>.merged(): List<NativeInline> {
        val out = mutableListOf<NativeInline>()
        for (item in this) {
            val previous = out.lastOrNull()
            // A line break ends the line: the soft break that follows it is not text.
            val inline = if (item is NativeInline.Text && previous == NativeInline.LineBreak) NativeInline.Text(item.text.trimStart()) else item
            if (inline is NativeInline.Text && inline.text.isEmpty()) continue
            if (inline is NativeInline.Text && previous is NativeInline.Text) out[out.lastIndex] = NativeInline.Text(previous.text + inline.text)
            else out += inline
        }
        return out
    }

    private val ATX_LEVELS = mapOf(
        MarkdownElementTypes.ATX_1 to 1, MarkdownElementTypes.ATX_2 to 2, MarkdownElementTypes.ATX_3 to 3,
        MarkdownElementTypes.ATX_4 to 4, MarkdownElementTypes.ATX_5 to 5, MarkdownElementTypes.ATX_6 to 6,
    )
    private val ESCAPE_OR_ENTITY = Regex("""\\([!-/:-@\[-`{-~])|&([a-zA-Z0-9]+);|&#([0-9]{1,7});|&#[xX]([0-9a-fA-F]{1,6});""")
    private val BREAK_TAG = Regex("""<br\s*/?>""", RegexOption.IGNORE_CASE)
    private val TAG = Regex("""<[^>]+>""")
    private val COMMENT = Regex("""<!--[\s\S]*?-->""")
    private val WHITESPACE = Regex("""\s+""")
}
