package dev.localmed.nativespike.shared.designsystem

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp

/** Web `.choice-chip` (and `--accent`, the download chip): icon disc, label over detail. */
@Composable
fun NativeChoiceChip(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    detail: String? = null,
    accent: Boolean = false,
    icon: @Composable (tint: Color) -> Unit,
) {
    val components = NativeDesign.components
    val chip = if (accent) components.downloadChip else components.choiceChip
    val iconStyle = if (accent) components.downloadChipIcon else components.choiceChipIcon
    val labelStyle = if (accent) components.downloadChipLabel else components.choiceChipLabel
    val detailStyle = if (accent) components.downloadChipDetail else components.choiceChipDetail
    Row(
        modifier
            .testTag(if (accent) "download-chip" else "choice-chip")
            .nativePressBox(chip, strong = accent) { source -> clickable(source, null, role = Role.Button, onClick = onClick) },
        horizontalArrangement = Arrangement.spacedBy(chip.columnGap),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.testTag(if (accent) "download-chip-icon" else "choice-chip-icon").nativeBox(iconStyle),
            contentAlignment = Alignment.Center,
        ) { icon(iconStyle.text.color) }
        // Web `.choice-chip__text`: gap 0.1rem between label and detail.
        Column(Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(CHIP_TEXT_GAP)) {
            BasicText(label, style = labelStyle.text.textStyle())
            detail?.let { BasicText(it, style = detailStyle.text.textStyle()) }
        }
    }
}

/** Web `.search-meanings__phrase`: the choice of what the query means, as a column of chips. */
@Composable
fun NativeMeanings(modifier: Modifier = Modifier, chips: @Composable () -> Unit) {
    val style = NativeDesign.components.meaningsPhrase
    Column(modifier.testTag("meanings-phrase"), verticalArrangement = Arrangement.spacedBy(style.rowGap)) { chips() }
}

/** Web `.ui-button--secondary`: a raised paper button with a bold label. */
@Composable
fun NativeSecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: (@Composable (tint: Color) -> Unit)? = null,
) {
    val style = NativeDesign.components.buttonSecondary
    Row(
        modifier.testTag("button-secondary").nativePressBox(style) { source -> clickable(source, null, role = Role.Button, onClick = onClick) },
        horizontalArrangement = Arrangement.spacedBy(style.columnGap),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon?.invoke(style.text.color)
        BasicText(style.text.display(text), style = style.text.textStyle(), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Web `.core-identity-matches__card`: a paper card naming one matched entity, with its actions. */
@Composable
fun NativeIdentityCard(
    title: String,
    modifier: Modifier = Modifier,
    note: String? = null,
    actions: @Composable () -> Unit = {},
) {
    val components = NativeDesign.components
    val card = components.identityCard
    Column(
        modifier.fillMaxWidth().testTag("identity-card").nativeBox(card),
        verticalArrangement = Arrangement.spacedBy(card.rowGap),
    ) {
        BasicText(title, Modifier.semantics { heading() }, style = components.identityTitle.text.textStyle())
        note?.let { BasicText(it, style = components.identityNote.text.textStyle()) }
        actions()
    }
}

/** A tag on a result header: web `.clinical-tags__tag`, an icon disc with an accessible name. */
@Immutable
data class NativeResultTag(val description: String, val icon: @Composable (tint: Color) -> Unit)

/** A result's download or open action (web `.result-group__action` accent chip). */
@Immutable
data class NativeResultAction(
    val label: String,
    val detail: String?,
    val onClick: () -> Unit,
    val icon: @Composable (tint: Color) -> Unit,
)

/** One matching fragment of a document. [highlights] are character ranges of [text]. */
@Immutable
data class NativeResultSnippet(
    val stamp: String?,
    val path: String?,
    val text: String,
    val highlights: List<IntRange>,
    val onOpen: () -> Unit,
    val categoryIcon: (@Composable (tint: Color) -> Unit)? = null,
)

/**
 * Web `.result-group`: a paper card whose header carries the faint position number, kind badge,
 * content kind, serif title, tags and a note; then an optional accent action and the matching
 * fragments. The card starts collapsed to its first fragment; «Ещё N» expands the rest.
 */
@Composable
fun NativeResultGroup(
    index: Int,
    kindLabel: String,
    title: String,
    snippets: List<NativeResultSnippet>,
    onOpen: () -> Unit,
    moreTitle: (hidden: Int) -> String,
    modifier: Modifier = Modifier,
    kindIcon: (@Composable (tint: Color) -> Unit)? = null,
    contentKind: String? = null,
    tags: List<NativeResultTag> = emptyList(),
    note: String? = null,
    action: NativeResultAction? = null,
    initiallyExpanded: Boolean = false,
) {
    val components = NativeDesign.components
    var expanded by remember { mutableStateOf(initiallyExpanded) }
    Column(modifier.fillMaxWidth().testTag("result-group").nativeBoxFrame(components.resultGroup).nativePadding(components.resultGroup)) {
        ResultHeader(index, kindLabel, kindIcon, contentKind, title, tags, note, onOpen)
        if (action != null) {
            val area = components.resultAction
            Box(Modifier.fillMaxWidth().testTag("result-action").nativePadding(area)) {
                NativeChoiceChip(action.label, action.onClick, Modifier.fillMaxWidth(), detail = action.detail, accent = true, icon = action.icon)
            }
        }
        val list = components.resultSnippets
        Column(
            Modifier.fillMaxWidth().testTag("result-snippets").background(components.resultGroup.borderColor),
            verticalArrangement = Arrangement.spacedBy(list.rowGap),
        ) {
            snippets.firstOrNull()?.let { ResultSnippet(it) }
            AnimatedVisibility(
                visible = expanded,
                enter = expandVertically(tween(220)) + fadeIn(tween(220)),
                exit = shrinkVertically(tween(180)) + fadeOut(tween(140)),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(list.rowGap)) {
                    snippets.drop(1).forEach { ResultSnippet(it) }
                }
            }
            if (snippets.size > 1) MoreToggle(moreTitle(snippets.size - 1), expanded) { expanded = !expanded }
        }
    }
}

@Composable
private fun ResultHeader(
    index: Int,
    kindLabel: String,
    kindIcon: (@Composable (tint: Color) -> Unit)?,
    contentKind: String?,
    title: String,
    tags: List<NativeResultTag>,
    note: String?,
    onOpen: () -> Unit,
) {
    val components = NativeDesign.components
    val header = components.resultHeader
    val body = components.resultHeaderBody
    Box(
        Modifier
            .fillMaxWidth()
            .testTag("result-header")
            .background(header.background)
            .drawBehind {
                val stroke = header.bottomBorderWidth.toPx()
                if (stroke > 0f) {
                    drawLine(header.bottomBorderColor, Offset(0f, size.height - stroke / 2), Offset(size.width, size.height - stroke / 2), stroke)
                }
            }
            .clickable(role = Role.Button, onClick = onOpen),
    ) {
        val indexStyle = components.resultIndex
        // Web: the position number sits at the top-right corner, 10% ink, cut by the card edge.
        BasicText(
            index.toString().padStart(2, '0'),
            Modifier.align(Alignment.TopEnd).offset(x = (-3).dp, y = (-3).dp).testTag("result-index").cssLineBox(indexStyle.text.lineHeight).alpha(indexStyle.opacity),
            style = indexStyle.text.textStyle(),
        )
        Column(
            Modifier.fillMaxWidth().nativePadding(body).padding(bottom = header.bottomBorderWidth),
            verticalArrangement = Arrangement.spacedBy(body.rowGap),
        ) {
            val kind = components.resultKind
            Row(
                Modifier.testTag("result-kind").nativeBox(kind),
                horizontalArrangement = Arrangement.spacedBy(kind.columnGap),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                kindIcon?.invoke(kind.text.color)
                BasicText(kindLabel, style = components.resultKindLabel.text.textStyle(), maxLines = 1)
            }
            contentKind?.let { BasicText(components.resultContentKind.text.display(it), style = components.resultContentKind.text.textStyle()) }
            BasicText(title, Modifier.semantics { heading() }.testTag("result-title"), style = components.resultTitle.text.textStyle())
            if (tags.isNotEmpty()) {
                Row(horizontalArrangement = Arrangement.spacedBy(NativeDimensions.space1)) {
                    val tag = components.clinicalTag
                    tags.forEach { item ->
                        Box(
                            Modifier.testTag("clinical-tag").nativeBox(tag).semantics { contentDescription = item.description },
                            contentAlignment = Alignment.Center,
                        ) { item.icon(tag.text.color) }
                    }
                }
            }
            // Web: `margin-top: 0.125rem`, at most two lines.
            note?.let {
                BasicText(
                    it,
                    Modifier.padding(top = NOTE_MARGIN),
                    style = components.resultNote.text.textStyle(),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/**
 * Lays [this] out in a box one CSS line tall: a 68 px numeral in a 51 px line overflows its line
 * box on the web, and Compose text never measures shorter than its font.
 */
private fun Modifier.cssLineBox(lineHeight: TextUnit): Modifier = layout { measurable, constraints ->
    val placeable = measurable.measure(constraints.copy(minHeight = 0, maxHeight = Constraints.Infinity))
    val height = lineHeight.roundToPx()
    layout(placeable.width, height) { placeable.place(0, (height - placeable.height) / 2) }
}

private val CHIP_TEXT_GAP = 1.6.dp
private val NOTE_MARGIN = 2.dp

@Composable
private fun ResultSnippet(snippet: NativeResultSnippet) {
    val components = NativeDesign.components
    val card = components.resultCard
    val open = components.resultOpen
    Column(
        Modifier
            .fillMaxWidth()
            .testTag("result-card")
            .background(card.background)
            .clickable(role = Role.Button, onClick = snippet.onOpen)
            .nativePadding(open),
    ) {
        // Web `.result-category-line` wraps: icon and stamp, then the path on its own line (gap 8).
        if (snippet.stamp != null || snippet.categoryIcon != null) {
            Row(
                Modifier.padding(bottom = NativeDimensions.space2),
                horizontalArrangement = Arrangement.spacedBy(NativeDimensions.space2),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                snippet.categoryIcon?.let { icon ->
                    val iconStyle = components.resultCategoryIcon
                    Box(Modifier.testTag("result-category-icon").nativeBox(iconStyle), contentAlignment = Alignment.Center) {
                        icon(iconStyle.text.color)
                    }
                }
                snippet.stamp?.let { stamp ->
                    val stampStyle = components.categoryStamp
                    BasicText(
                        stampStyle.text.display(stamp),
                        Modifier.testTag("category-stamp").nativeBox(stampStyle),
                        style = stampStyle.text.textStyle(),
                        maxLines = 1,
                    )
                }
            }
        }
        snippet.path?.let { path ->
            val pathStyle = components.resultPath
            BasicText(
                pathStyle.text.display(path),
                Modifier.testTag("result-path").nativePadding(pathStyle),
                style = pathStyle.text.textStyle(),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        // Web: `margin: 0.3125rem 0` and a two-line clamp.
        BasicText(
            highlighted(snippet.text, snippet.highlights, components.highlight.background),
            Modifier.testTag("result-snippet").padding(vertical = SNIPPET_MARGIN),
            style = components.resultSnippet.text.textStyle(),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private val SNIPPET_MARGIN = 5.dp

private fun highlighted(text: String, ranges: List<IntRange>, background: Color): AnnotatedString = buildAnnotatedString {
    append(text)
    for (range in ranges) {
        val start = range.first.coerceIn(0, text.length)
        val end = (range.last + 1).coerceIn(start, text.length)
        if (end > start) addStyle(SpanStyle(background = background), start, end)
    }
}

@Composable
private fun MoreToggle(title: String, expanded: Boolean, onToggle: () -> Unit) {
    val components = NativeDesign.components
    val header = components.moreHeader
    val chevron = components.moreChevron
    val rotation by animateFloatAsState(if (expanded) 180f else 0f, tween(200))
    Row(
        Modifier
            .fillMaxWidth()
            .testTag("more-header")
            .background(components.resultMore.background)
            .semantics { stateDescription = if (expanded) "Развёрнуто" else "Свёрнуто" }
            .clickable(role = Role.Button, onClick = onToggle)
            .nativeBox(header),
        horizontalArrangement = Arrangement.spacedBy(header.columnGap),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BasicText(title, Modifier.weight(1f), style = components.moreTitle.text.textStyle())
        // A caret drawn in ink, turned up when open: the design system has no glyph set of its own.
        Box(
            Modifier.testTag("more-chevron").nativeBox(chevron).rotate(rotation).drawBehind {
                val half = size.minDimension * 0.18f
                val stroke = 1.6.dp.toPx()
                val top = Offset(center.x - half, center.y - half / 2)
                val tip = Offset(center.x, center.y + half / 2)
                drawLine(chevron.text.color, top, tip, stroke, StrokeCap.Round)
                drawLine(chevron.text.color, tip, Offset(center.x + half, center.y - half / 2), stroke, StrokeCap.Round)
            },
        )
    }
}
