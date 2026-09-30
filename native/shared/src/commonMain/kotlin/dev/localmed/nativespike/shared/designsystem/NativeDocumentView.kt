package dev.localmed.nativespike.shared.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import dev.localmed.nativespike.shared.reader.NativeBlock
import dev.localmed.nativespike.shared.reader.NativeCellAlign
import dev.localmed.nativespike.shared.reader.NativeDocument
import dev.localmed.nativespike.shared.reader.NativeInline
import dev.localmed.nativespike.shared.reader.plainText

/** Reader text scale steps, as the web reader's `DOCUMENT_TEXT_SCALE_LEVELS` (percent). */
val NATIVE_READER_TEXT_SCALES = listOf(90, 100, 110, 125, 140)

/**
 * What a document view needs from its screen: the text scale, how to open a link, how to show an
 * image (the screen knows where the file's images live) and find hits per block.
 */
@Immutable
data class NativeDocumentActions(
    val textScale: Int = 100,
    val onLink: (String) -> Unit = {},
    val image: (@Composable (source: String, alt: String, modifier: Modifier) -> Unit)? = null,
    /** Character ranges of [NativeBlock.plainText] to mark, by block index. */
    val hits: (blockIndex: Int) -> List<IntRange> = { emptyList() },
)

/**
 * The document's blocks as lazy list items, one per block and keyed by position, so a screen can
 * put its own items first and scroll to a block by index ([listIndexOf]). Section titles are
 * ordinary items; [NativeDocumentReaderOverlays] pins the current one under the reader bar.
 */
fun LazyListScope.nativeDocumentItems(document: NativeDocument, actions: NativeDocumentActions) {
    document.blocks.forEachIndexed { index, block ->
        val spacing = spacingBefore(block, document.blocks.getOrNull(index - 1), actions.textScale)
        item(key = "block-$index", contentType = block::class.simpleName) {
            NativeDocumentBlock(block, actions, index, Modifier.padding(top = spacing))
        }
    }
}

/** Index in [NativeDocument.blocks] of the heading with [anchor], or -1. */
fun NativeDocument.blockIndexOf(anchor: String): Int =
    blocks.indexOfFirst { it is NativeBlock.Heading && it.anchor == anchor }

/** The lazy list index of block [blockIndex] when [itemsBefore] screen items precede the blocks. */
fun NativeDocument.listIndexOf(blockIndex: Int, itemsBefore: Int = 0): Int = itemsBefore + blockIndex.coerceIn(0, blocks.lastIndex.coerceAtLeast(0))

/** The block shown by lazy list item [listIndex], or -1 for the screen's own leading items. */
fun NativeDocument.blockIndexAt(listIndex: Int, itemsBefore: Int = 0): Int =
    if (listIndex < itemsBefore) -1 else (listIndex - itemsBefore).coerceAtMost(blocks.lastIndex)

private fun spacingBefore(block: NativeBlock, previous: NativeBlock?, scale: Int) = when {
    previous == null -> 0.dp
    block is NativeBlock.Heading && block.level == 2 -> 24.dp
    block is NativeBlock.Heading -> (headingSize(block.level).value * 1.2f * scale / 100f).dp
    previous is NativeBlock.Heading -> 10.dp
    block is NativeBlock.Code || block is NativeBlock.Math || block is NativeBlock.Table || block is NativeBlock.Rule -> 16.dp
    else -> 12.8.dp
}

/** Web `.safe-markdown` heading sizes at phone width; level 2 is the reader's section title. */
private fun headingSize(level: Int): TextUnit = when (level) {
    1 -> 28.sp
    2 -> 20.sp
    3 -> 19.2.sp
    else -> 16.8.sp
}

@Composable
fun NativeDocumentBlock(block: NativeBlock, actions: NativeDocumentActions, index: Int, modifier: Modifier = Modifier) {
    val components = NativeDesign.components
    val colors = NativeDesign.colors
    val scale = actions.textScale / 100f
    val body = components.readerParagraph.text.textStyle().scaled(scale)
    val gutter = components.readerPaper.padding
    val inset = Modifier.padding(start = gutter.start, end = gutter.end)
    when (block) {
        is NativeBlock.Heading -> {
            val hits = actions.hits(index)
            if (block.level == 2) {
                val title = components.readerSectionTitle
                // Web: a sticky title on paper with a hairline under it.
                BasicText(
                    annotated(block.inlines, hits, actions),
                    modifier
                        .fillMaxWidth()
                        .testTag("reader-section-title")
                        .semantics { heading() }
                        .background(title.background)
                        .drawBehind { drawLine(colors.border, Offset(0f, size.height - 0.5f), Offset(size.width, size.height - 0.5f), 1.dp.toPx()) }
                        .nativePadding(title),
                    style = title.text.textStyle().scaled(scale),
                )
            } else {
                BasicText(
                    annotated(block.inlines, hits, actions),
                    modifier.then(inset).fillMaxWidth().semantics { heading() },
                    style = TextStyle(
                        fontFamily = NativeFontFamilies.serif,
                        fontSize = headingSize(block.level) * scale,
                        fontWeight = FontWeight.Medium,
                        lineHeight = 1.2.em,
                        color = colors.text,
                    ),
                )
            }
        }
        is NativeBlock.Paragraph -> BasicText(
            annotated(block.inlines, actions.hits(index), actions),
            modifier.then(inset).fillMaxWidth().testTag("reader-paragraph"),
            style = body,
        )
        is NativeBlock.Raw -> BasicText(block.text, modifier.then(inset).fillMaxWidth(), style = body)
        else -> Box(modifier.then(inset).fillMaxWidth()) { NestedBlock(block, actions, body, actions.hits(index)) }
    }
}

/** Blocks that also appear inside list items and quotes. */
@Composable
private fun NestedBlock(block: NativeBlock, actions: NativeDocumentActions, body: TextStyle, hits: List<IntRange> = emptyList()) {
    val colors = NativeDesign.colors
    val scale = actions.textScale / 100f
    when (block) {
        is NativeBlock.Paragraph -> BasicText(annotated(block.inlines, emptyList(), actions), Modifier.fillMaxWidth(), style = body)
        is NativeBlock.Heading -> BasicText(
            annotated(block.inlines, emptyList(), actions),
            Modifier.fillMaxWidth().semantics { heading() },
            style = body.copy(fontFamily = NativeFontFamilies.serif, fontSize = headingSize(block.level) * scale, lineHeight = 1.2.em),
        )
        is NativeBlock.Raw -> BasicText(block.text, Modifier.fillMaxWidth(), style = body)
        is NativeBlock.ListBlock -> {
            val list = NativeDesign.components.readerList
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                block.items.forEachIndexed { position, item ->
                    Row(Modifier.fillMaxWidth()) {
                        val marker = when {
                            item.checked == true -> "☑"
                            item.checked == false -> "☐"
                            block.ordered -> "${block.start + position}."
                            else -> "•"
                        }
                        // Web `padding-left: 20px` holds the marker; wider ordinals take more room.
                        BasicText(marker, Modifier.widthIn(min = list.padding.start).padding(end = 4.dp), style = body.copy(color = colors.textMuted))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            item.blocks.forEach { NestedBlock(it, actions, body) }
                        }
                    }
                }
            }
        }
        is NativeBlock.Quote -> {
            val accent = if (block.alert in setOf("WARNING", "CAUTION")) colors.warning else colors.accent
            val soft = if (block.alert in setOf("WARNING", "CAUTION")) colors.warningSoft else colors.accentSoft
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(soft)
                    .drawBehind { drawRect(accent, size = size.copy(width = 3.2.dp.toPx())) }
                    .padding(start = 14.4.dp + 3.2.dp, end = 14.4.dp, top = 7.2.dp, bottom = 7.2.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                block.alert?.let { BasicText(ALERT_TITLES[it] ?: it, style = body.copy(color = accent, fontWeight = FontWeight.Bold)) }
                block.blocks.forEach { NestedBlock(it, actions, body.copy(color = colors.textMuted)) }
            }
        }
        is NativeBlock.Code -> CodeBox(block.text, colors.text, TextAlign.Start, scale)
        is NativeBlock.Math -> CodeBox(block.tex, colors.accent, TextAlign.Center, scale)
        is NativeBlock.Table -> NativeDocumentTable(block, actions, scale, hits)
        is NativeBlock.Image -> DocumentImage(block.source, block.alt, block.title, actions, scale)
        NativeBlock.Rule -> Box(Modifier.fillMaxWidth().height(1.dp).background(colors.border))
        is NativeBlock.PageMark -> BasicText(
            "Страница ${block.page}",
            Modifier.fillMaxWidth(),
            style = NativeDesign.components.resultPath.text.textStyle().copy(textAlign = TextAlign.Center),
        )
    }
}

@Composable
private fun CodeBox(text: String, color: Color, align: TextAlign, scale: Float) {
    val colors = NativeDesign.colors
    val shape = RoundedCornerShape(NativeDimensions.radiusControl)
    BasicText(
        text,
        Modifier
            .fillMaxWidth()
            .background(colors.surfaceMuted, shape)
            .border(1.dp, colors.border, shape)
            .padding(horizontal = 16.dp, vertical = 14.4.dp),
        style = TextStyle(fontFamily = nativeMonoFontFamily(), fontSize = 12.8.sp * scale, lineHeight = 1.5.em, color = color, textAlign = align),
    )
}

@Composable
private fun DocumentImage(source: String, alt: String, title: String?, actions: NativeDocumentActions, scale: Float) {
    val components = NativeDesign.components
    val colors = NativeDesign.colors
    Column(Modifier.fillMaxWidth().testTag("reader-image"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        val frame = Modifier
            .heightIn(max = 448.dp)
            .border(1.dp, colors.border, RoundedCornerShape(components.readerImagePicture.corner))
        val image = actions.image
        if (image != null) {
            image(source, alt, frame)
        } else {
            // No image loader: the alternative text stands in, as a browser shows a broken image.
            BasicText(
                alt.ifBlank { source },
                frame.fillMaxWidth().background(colors.surfaceMuted).padding(12.dp),
                style = components.readerImageCaption.text.textStyle().scaled(scale),
            )
        }
        val caption = title ?: alt.takeIf { it.isNotBlank() && image != null }
        caption?.let { BasicText(it, style = components.readerImageCaption.text.textStyle().scaled(scale)) }
    }
}

/**
 * Web `.safe-markdown table`: bordered cells, header cells on the muted surface, columns as wide
 * as their content up to a cap, the whole table scrolling sideways when wider than the page.
 */
@Composable
private fun NativeDocumentTable(table: NativeBlock.Table, actions: NativeDocumentActions, scale: Float, hits: List<IntRange>) {
    val colors = NativeDesign.colors
    val columns = table.rows.maxOfOrNull { row -> row.cells.sumOf { it.colSpan } } ?: 0
    if (columns == 0) return
    val cellText = TextStyle(fontFamily = NativeFontFamilies.sans, fontSize = 13.76.sp * scale, lineHeight = 1.45.em, color = colors.text)
    val cells = remember(table) { table.rows.flatMapIndexed { row, cells -> cells.cells.map { row to it } } }
    // Start of each cell's text in the table's plain text (cells joined by tabs, rows by newlines).
    val starts = remember(table) {
        var offset = 0
        table.rows.flatMap { row ->
            row.cells.map { cell -> offset.also { offset += cell.inlines.plainText().length + 1 } }
        }
    }
    BoxWithConstraints(Modifier.fillMaxWidth().testTag("reader-table")) {
      val page = maxWidth
      Box(Modifier.horizontalScroll(rememberScrollState())) {
        Layout(
            modifier = Modifier.widthIn(min = page),
            content = {
                cells.forEachIndexed { cellIndex, (_, cell) ->
                    val start = starts[cellIndex]
                    val end = start + cell.inlines.plainText().length
                    val cellHits = hits.filter { it.first >= start && it.last < end }.map { (it.first - start)..(it.last - start) }
                    val align = when (cell.align) {
                        NativeCellAlign.Center -> TextAlign.Center
                        NativeCellAlign.End -> TextAlign.End
                        else -> TextAlign.Start
                    }
                    BasicText(
                        annotated(cell.inlines, cellHits, actions),
                        Modifier
                            .background(if (cell.header) colors.surfaceMuted else Color.Transparent)
                            .border(0.5.dp, colors.border)
                            .padding(horizontal = 10.4.dp, vertical = 8.dp),
                        style = cellText.copy(fontWeight = if (cell.header) FontWeight.Bold else FontWeight.Normal, textAlign = align),
                    )
                }
            },
        ) { measurables, constraints ->
            val cap = TABLE_COLUMN_CAP.roundToPx()
            // CSS automatic table layout, simplified: each column gets at least its longest word
            // and at most its unwrapped text (capped); spare page width goes to the columns that
            // would wrap. Only a table whose words alone overflow the page scrolls sideways.
            val least = IntArray(columns)
            val most = IntArray(columns)
            var index = 0
            val positions = ArrayList<Pair<Int, Int>>(cells.size)
            val rowCount = table.rows.size
            for (row in 0 until rowCount) {
                var column = 0
                for (cell in table.rows[row].cells) {
                    positions += row to column
                    if (cell.colSpan == 1 && column < columns) {
                        least[column] = maxOf(least[column], minOf(cap, measurables[index].minIntrinsicWidth(Constraints.Infinity)))
                        most[column] = maxOf(most[column], minOf(cap, measurables[index].maxIntrinsicWidth(Constraints.Infinity)))
                    }
                    column += cell.colSpan
                    index++
                }
            }
            val available = constraints.minWidth
            val widths = when {
                most.sum() <= available -> IntArray(columns) { most[it] + (available - most.sum()) / columns }
                least.sum() >= available -> least
                else -> {
                    val share = (available - least.sum()).toFloat() / (most.sum() - least.sum())
                    IntArray(columns) { least[it] + ((most[it] - least[it]) * share).toInt() }
                }
            }
            val cellWidths = IntArray(measurables.size) { cellIndex ->
                val column = positions[cellIndex].second
                val span = cells[cellIndex].second.colSpan
                (column until minOf(columns, column + span)).sumOf { widths[it] }.coerceAtLeast(1)
            }
            val rowHeights = IntArray(rowCount)
            measurables.forEachIndexed { cellIndex, measurable ->
                val row = positions[cellIndex].first
                rowHeights[row] = maxOf(rowHeights[row], measurable.minIntrinsicHeight(cellWidths[cellIndex]))
            }
            val remeasured = measurables.mapIndexed { cellIndex, measurable ->
                measurable.measure(Constraints.fixed(cellWidths[cellIndex], rowHeights[positions[cellIndex].first]))
            }
            layout(widths.sum(), rowHeights.sum()) {
                val columnStarts = widths.runningFold(0) { start, width -> start + width }
                val rowStarts = rowHeights.toList().runningFold(0) { start, height -> start + height }
                remeasured.forEachIndexed { cellIndex, placeable ->
                    val (row, column) = positions[cellIndex]
                    placeable.place(columnStarts[minOf(column, columns)], rowStarts[row])
                }
            }
        }
      }
    }
}

private val TABLE_COLUMN_CAP = 260.dp

/**
 * Inline content as styled text whose characters equal [List.plainText], so find ranges map
 * straight onto it. Links carry a click annotation that calls [NativeDocumentActions.onLink].
 */
@Composable
private fun annotated(inlines: List<NativeInline>, hits: List<IntRange>, actions: NativeDocumentActions): AnnotatedString {
    val colors = NativeDesign.colors
    val link = TextLinkStyles(SpanStyle(color = colors.link, textDecoration = TextDecoration.Underline))
    val mono = nativeMonoFontFamily()
    return remember(inlines, hits, colors, actions.onLink) {
        buildAnnotatedString {
            fun append(items: List<NativeInline>) {
                for (inline in items) when (inline) {
                    is NativeInline.Text -> append(inline.text)
                    is NativeInline.Emphasis -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(inline.children) }
                    is NativeInline.Strong -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(inline.children) }
                    is NativeInline.Strike -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { append(inline.children) }
                    is NativeInline.Mark -> withStyle(SpanStyle(background = colors.accentSoft)) { append(inline.children) }
                    is NativeInline.Code -> withStyle(SpanStyle(fontFamily = mono, fontSize = 0.88.em, background = colors.surfaceMuted)) { append(inline.text) }
                    is NativeInline.Math -> withStyle(SpanStyle(fontFamily = mono, fontSize = 0.88.em, color = colors.accent)) { append(inline.tex) }
                    is NativeInline.Link -> withLink(LinkAnnotation.Clickable(inline.target, link) { actions.onLink(inline.target) }) { append(inline.children) }
                    is NativeInline.Image -> withStyle(SpanStyle(color = colors.textMuted, fontStyle = FontStyle.Italic)) { append(inline.alt) }
                    NativeInline.LineBreak -> append('\n')
                }
            }
            append(inlines)
            for (hit in hits) {
                val start = hit.first.coerceIn(0, length)
                val end = (hit.last + 1).coerceIn(start, length)
                if (end > start) addStyle(SpanStyle(background = colors.matchBackground, color = colors.matchText), start, end)
            }
        }
    }
}

private fun TextStyle.scaled(scale: Float): TextStyle =
    if (scale == 1f) this else copy(fontSize = fontSize * scale, lineHeight = if (lineHeight.isSp) lineHeight * scale else lineHeight)

private val ALERT_TITLES = mapOf(
    "NOTE" to "Примечание",
    "TIP" to "Совет",
    "IMPORTANT" to "Важно",
    "WARNING" to "Внимание",
    "CAUTION" to "Осторожно",
)
