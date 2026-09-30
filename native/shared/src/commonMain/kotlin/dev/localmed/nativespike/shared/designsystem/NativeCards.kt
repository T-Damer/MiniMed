package dev.localmed.nativespike.shared.designsystem

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role

/** One button of a card: primary or secondary is decided by its position. */
@Immutable
data class NativeCardAction(
    val text: String,
    val onClick: () -> Unit,
    val icon: (@Composable (tint: Color) -> Unit)? = null,
)

/**
 * Web `.home-feature`: kicker with an optional help control, title, text and up to two actions.
 * The actions always share one row as web `flex: 1 1 auto` (`.ecg-picker__option--stretch`): each
 * grows from its natural width, and a label that still does not fit shrinks instead of wrapping.
 */
@Composable
fun NativeFeatureCard(
    kicker: String,
    title: String,
    text: String,
    primary: NativeCardAction,
    modifier: Modifier = Modifier,
    secondary: NativeCardAction? = null,
    kickerIcon: (@Composable (tint: Color) -> Unit)? = null,
    help: (@Composable () -> Unit)? = null,
) {
    val components = NativeDesign.components
    val card = components.featureCard
    Column(modifier.fillMaxWidth().testTag("feature-card").nativeBox(card)) {
        Column(verticalArrangement = Arrangement.spacedBy(card.rowGap)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            val kickerStyle = components.featureKicker
            Row(
                Modifier.weight(1f).testTag("feature-kicker"),
                horizontalArrangement = Arrangement.spacedBy(kickerStyle.columnGap.coerceAtLeast(NativeDimensions.space1)),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                kickerIcon?.invoke(kickerStyle.text.color)
                BasicText(kickerStyle.text.display(kicker), style = kickerStyle.text.textStyle())
            }
            help?.invoke()
        }
        BasicText(
            components.featureTitle.text.display(title),
            Modifier.testTag("feature-title"),
            style = components.featureTitle.text.textStyle(),
        )
        BasicText(
            components.featureText.text.display(text),
            Modifier.testTag("feature-text"),
            style = components.featureText.text.textStyle(),
        )
        }
        // In a carousel every card takes the tallest card's height; the actions stay at the bottom.
        Spacer(Modifier.weight(1f))
        Spacer(Modifier.height(card.rowGap))
        NativeFlexRow(components.featureActions.columnGap, Modifier.fillMaxWidth().testTag("feature-actions")) {
            NativeActionButton(primary.text, primary.onClick, primary = true, icon = primary.icon)
            if (secondary != null) {
                NativeActionButton(secondary.text, secondary.onClick, primary = false, icon = secondary.icon)
            }
        }
    }
}

/** Web `.search-core-status`: the database status card with a spinner slot. */
@Composable
fun NativeStatusCard(
    title: String,
    detail: String,
    modifier: Modifier = Modifier,
    indicator: (@Composable () -> Unit)? = null,
) {
    val components = NativeDesign.components
    val style = components.coreStatus
    Row(
        modifier.fillMaxWidth().testTag("core-status").nativeBox(style),
        horizontalArrangement = Arrangement.spacedBy(style.columnGap.coerceAtLeast(NativeDimensions.space3)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        indicator?.invoke()
        Column {
            BasicText(title, Modifier.testTag("core-status-title"), style = components.coreStatusTitle.text.textStyle())
            BasicText(detail, Modifier.testTag("core-status-detail"), style = components.coreStatusDetail.text.textStyle())
        }
    }
}

/** Web `.search-sections`: a serif title over a paper list of rows. */
@Composable
fun NativeSectionList(title: String, modifier: Modifier = Modifier, rows: @Composable () -> Unit) {
    val components = NativeDesign.components
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(NativeDimensions.space2)) {
        val titleStyle = components.sectionsTitle
        BasicText(
            titleStyle.text.display(title),
            Modifier.testTag("sections-title").padding(
                start = titleStyle.padding.start,
                end = titleStyle.padding.end,
            ),
            style = titleStyle.text.textStyle(),
        )
        Column(Modifier.fillMaxWidth().testTag("sections-list").nativeBox(components.sectionsList)) { rows() }
    }
}

/**
 * Web `.search-sections__row`: icon frame, name over count, caret. Rows after the first carry the
 * web's top separator (`.search-sections__item + .search-sections__item`).
 */
@Composable
fun NativeSectionRow(
    name: String,
    count: String,
    first: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: @Composable (tint: Color) -> Unit,
    caret: (@Composable (tint: Color) -> Unit)? = null,
) {
    val components = NativeDesign.components
    val row = components.sectionRow
    val separator = components.sectionItemNext
    Row(
        modifier
            .fillMaxWidth()
            .drawBehind {
                if (!first && separator.borderWidth.value > 0f) {
                    val stroke = separator.borderWidth.toPx()
                    drawLine(
                        separator.borderColor,
                        Offset(0f, stroke / 2),
                        Offset(size.width, stroke / 2),
                        strokeWidth = stroke,
                    )
                }
            }
            .testTag("section-row")
            .nativeBoxFrame(row)
            .clickable(role = Role.Button, onClick = onClick)
            .nativePadding(row),
        horizontalArrangement = Arrangement.spacedBy(row.columnGap),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val frame = components.sectionIconFrame
        Box(Modifier.testTag("section-icon-frame").nativeBox(frame), contentAlignment = Alignment.Center) {
            icon(frame.text.color)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(row.rowGap)) {
            BasicText(name, Modifier.testTag("section-name"), style = components.sectionName.text.textStyle(), maxLines = 1)
            BasicText(count, Modifier.testTag("section-count"), style = components.sectionCount.text.textStyle(), maxLines = 1)
        }
        caret?.invoke(components.sectionCount.text.color)
    }
}
