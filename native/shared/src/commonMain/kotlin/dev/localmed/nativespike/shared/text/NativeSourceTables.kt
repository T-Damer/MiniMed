package dev.localmed.nativespike.shared.text

import dev.localmed.nativespike.shared.reader.NativeMarkdownImporter
import org.intellij.markdown.IElementType
import org.intellij.markdown.MarkdownElementTypes
import org.intellij.markdown.MarkdownTokenTypes
import org.intellij.markdown.ast.ASTNode
import org.intellij.markdown.flavours.gfm.GFMElementTypes
import org.intellij.markdown.flavours.gfm.GFMFlavourDescriptor
import org.intellij.markdown.flavours.gfm.GFMTokenTypes
import org.intellij.markdown.parser.MarkdownParser

internal data class NativeSourceTableSlice(val start: Int, val end: Int, val table: NativeSourceRichBlock.Table)
private val tableCandidate = Regex("^[ \\t]*\\|?[ \\t]*:?-+:?[ \\t]*(?:\\||$)", RegexOption.MULTILINE)

internal fun nativeSourceTables(value: String): List<NativeSourceTableSlice> {
    if ('|' !in value || !tableCandidate.containsMatchIn(value)) return emptyList()
    return MarkdownParser(GFMFlavourDescriptor()).buildMarkdownTreeFromString(value).children
        .filter { it.type == GFMElementTypes.TABLE }.map { node ->
            NativeSourceTableSlice(node.startOffset, node.endOffset, sourceTable(value.substring(node.startOffset, node.endOffset)))
        }
}

/** JetBrains GFM clips cells beyond the header; Web preserves them. Widen only the parse view. */
private fun sourceTable(source: String): NativeSourceRichBlock.Table {
    fun content(line: String): String {
        val trimmed = line.trim(' ', '\t', '\r').removePrefix("|")
        val slashCount = trimmed.dropLast(1).takeLastWhile { it == '\\' }.length
        return if (trimmed.endsWith('|') && slashCount % 2 == 0) trimmed.dropLast(1) else trimmed
    }
    fun columns(line: String): Int {
        var count = 1
        var escaped = false
        for (char in content(line)) {
            if (char == '|' && !escaped) count++
            escaped = char == '\\' && !escaped
        }
        return count
    }
    val lines = source.lines().toMutableList()
    val headerColumns = columns(lines.first())
    val aligns = content(lines[1]).split('|').map { column ->
        val spec = column.trim(' ', '\t')
        when {
            spec.startsWith(':') && spec.endsWith(':') -> "center"
            spec.startsWith(':') -> "left"
            spec.endsWith(':') -> "right"
            else -> null
        }
    }
    val missing = (lines.drop(2).maxOfOrNull(::columns) ?: headerColumns) - headerColumns
    if (missing > 0) {
        lines[0] = "| ${content(lines[0])} |" + " |".repeat(missing)
        lines[1] = "| ${content(lines[1])} |" + " --- |".repeat(missing)
    }
    val view = lines.joinToString("\n")
    val node = MarkdownParser(GFMFlavourDescriptor()).buildMarkdownTreeFromString(view).children.first { it.type == GFMElementTypes.TABLE }
    return NativeSourceRichBlock.Table("", node.children.filter { it.type == GFMElementTypes.HEADER || it.type == GFMElementTypes.ROW }.mapIndexed { index, row ->
        val cells = row.children.filter { it.type == GFMTokenTypes.CELL }.let { if (index == 0) it.take(headerColumns) else it }
        NativeSourceTableRow(cells.mapIndexed { column, cell ->
            NativeSourceTableCell(sourceCellText(cell, view), index == 0, align = aligns.getOrNull(column))
        })
    })
}

/** Web markdownNodeText reads AST values, retaining raw HTML, and has no image-alt value. */
private fun sourceCellText(cell: ASTNode, source: String): String {
    var start = cell.startOffset
    var end = cell.endOffset
    while (start < end && source[start] in " \t") start++
    while (end > start && source[end - 1] in " \t") end--
    fun raw(node: ASTNode): String = source.substring(node.startOffset.coerceAtLeast(start).coerceAtMost(end), node.endOffset.coerceAtMost(end).coerceAtLeast(start))
    fun inner(node: ASTNode, delimiter: IElementType): List<ASTNode> = node.children
        .dropWhile { it.type == delimiter }.dropLastWhile { it.type == delimiter }
    fun text(node: ASTNode): String = when (node.type) {
        MarkdownElementTypes.IMAGE -> ""
        MarkdownTokenTypes.HTML_TAG -> raw(node)
        MarkdownElementTypes.CODE_SPAN -> {
            val nodes = inner(node, MarkdownTokenTypes.BACKTICK)
            val value = if (nodes.isEmpty()) "" else source.substring(nodes.first().startOffset, nodes.last().endOffset).replace('\n', ' ')
            if (value.length >= 2 && value.startsWith(' ') && value.endsWith(' ') && value.any { it != ' ' }) value.drop(1).dropLast(1) else value
        }
        MarkdownElementTypes.EMPH, MarkdownElementTypes.STRONG -> inner(node, MarkdownTokenTypes.EMPH).joinToString("") { text(it) }
        GFMElementTypes.STRIKETHROUGH -> inner(node, GFMTokenTypes.TILDE).joinToString("") { text(it) }
        GFMElementTypes.HIGHLIGHT -> inner(node, GFMTokenTypes.EQUALS).joinToString("") { text(it) }
        MarkdownElementTypes.INLINE_LINK, MarkdownElementTypes.FULL_REFERENCE_LINK, MarkdownElementTypes.SHORT_REFERENCE_LINK ->
            node.children.firstOrNull { it.type == MarkdownElementTypes.LINK_TEXT || it.type == MarkdownElementTypes.LINK_LABEL }
                ?.children.orEmpty().filter { it.type != MarkdownTokenTypes.LBRACKET && it.type != MarkdownTokenTypes.RBRACKET }.joinToString("") { text(it) }
        MarkdownElementTypes.AUTOLINK -> node.children.filter { it.type == MarkdownTokenTypes.AUTOLINK || it.type == MarkdownTokenTypes.EMAIL_AUTOLINK }.joinToString("") { raw(it) }
        MarkdownTokenTypes.HARD_LINE_BREAK -> ""
        else -> if (node.children.isEmpty()) NativeMarkdownImporter.unescape(raw(node)) else node.children.joinToString("") { text(it) }
    }
    return text(cell)
}
