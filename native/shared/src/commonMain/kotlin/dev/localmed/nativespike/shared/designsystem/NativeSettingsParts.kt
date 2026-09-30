package dev.localmed.nativespike.shared.designsystem

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/**
 * The paper of web `.paper-sheet`: a faint red margin line 44 px from the left and ruled lines every
 * 30 px, drawn under the content.
 */
fun Modifier.nativePaperRules(): Modifier = drawBehind {
    val line = 1.dp.toPx()
    val step = 30.dp.toPx()
    var y = step - line
    while (y < size.height) {
        drawRect(RULE, topLeft = Offset(0f, y), size = size.copy(height = line))
        y += step
    }
    drawRect(MARGIN, topLeft = Offset(44.dp.toPx() - line, 0f), size = size.copy(width = line))
}

private val RULE = Color(0x144A5352)
private val MARGIN = Color(0x2187453C)

/** Web `.paper-sheet` (settings sections): a ruled paper card holding a column of rows. */
@Composable
fun NativePaperSheet(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val style = NativeDesign.components.paperSheet
    Column(
        modifier.fillMaxWidth().testTag("paper-sheet").nativeBoxFrame(style).nativePaperRules().nativePadding(style),
        verticalArrangement = Arrangement.spacedBy(style.rowGap),
        content = content,
    )
}

/** Web `.page__header`: an icon, the page title and its one-line description. */
@Composable
fun NativePageHeader(title: String, modifier: Modifier = Modifier, description: String? = null, icon: (@Composable (tint: Color) -> Unit)? = null) {
    val components = NativeDesign.components
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(5.6.dp)) {
        val row = components.pageTitleRow
        Row(horizontalArrangement = Arrangement.spacedBy(row.columnGap), verticalAlignment = Alignment.CenterVertically) {
            icon?.let { Box(Modifier.nativeBox(components.pageIcon), contentAlignment = Alignment.Center) { it(components.pageIcon.text.color) } }
            BasicText(title, Modifier.semantics { heading() }, style = components.pageTitle.text.textStyle())
        }
        description?.let { BasicText(it, style = components.pageDescription.text.textStyle()) }
    }
}

/** Web `.settings-page__group-title` and its description: a serif heading between sheets. */
@Composable
fun NativeGroupTitle(title: String, modifier: Modifier = Modifier, description: String? = null) {
    val components = NativeDesign.components
    Column(modifier.fillMaxWidth()) {
        val style = components.settingsGroupTitle
        BasicText(title, Modifier.semantics { heading() }.nativePadding(style), style = style.text.textStyle())
        description?.let { BasicText(it, Modifier.nativePadding(components.settingsGroupDescription), style = components.settingsGroupDescription.text.textStyle()) }
    }
}

/** Web `.settings-section__heading`: an icon, a serif title and a short description. */
@Composable
fun NativeSectionHeading(title: String, modifier: Modifier = Modifier, description: String? = null, icon: (@Composable (tint: Color) -> Unit)? = null) {
    val components = NativeDesign.components
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        icon?.let { Box(Modifier.nativeBox(components.settingsSectionIcon), contentAlignment = Alignment.Center) { it(components.settingsSectionIcon.text.color) } }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            BasicText(title, Modifier.semantics { heading() }, style = components.settingsSectionTitle.text.textStyle())
            description?.let { BasicText(it, style = components.settingsSectionDescription.text.textStyle()) }
        }
    }
}

/**
 * Web `.ui-switch`: a pill track with a round thumb that slides 21 px; the accent track means on.
 * Visual only — the row that owns it carries the toggle semantics.
 */
@Composable
fun NativeSwitch(checked: Boolean, modifier: Modifier = Modifier) {
    val components = NativeDesign.components
    val track = if (checked) components.switchTrackOn else components.switchTrack
    val thumb = if (checked) components.switchThumbOn else components.switchThumb
    val color by animateColorAsState(track.background, tween(160), label = "switch-track")
    val shift by animateDpAsState(if (checked) SWITCH_TRAVEL else 0.dp, tween(160), label = "switch-thumb")
    Box(modifier.testTag("switch").size(components.switch.width ?: 44.dp, components.switch.height ?: 26.dp).background(color, CircleShape)) {
        Box(Modifier.offset(x = 3.dp + shift, y = 3.dp).nativeBoxFrame(thumb))
    }
}

private val SWITCH_TRAVEL = 21.dp

/**
 * Web `.settings-row`: an icon and label over a helper line, a switch on the right. The whole row
 * is the switch for touch and accessibility.
 */
@Composable
fun NativeSettingSwitch(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    helper: String? = null,
    icon: (@Composable (tint: Color) -> Unit)? = null,
) {
    val components = NativeDesign.components
    val row = components.settingsRow
    Row(
        modifier.fillMaxWidth().testTag("settings-row").toggleable(checked, role = Role.Switch, onValueChange = onCheckedChange),
        horizontalArrangement = Arrangement.spacedBy(row.columnGap),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        NativeSettingText(label, helper, icon, Modifier.weight(1f))
        NativeSwitch(checked)
    }
}

/** Label with its icon over the helper text, as a settings row shows them. */
@Composable
fun NativeSettingText(label: String, helper: String?, icon: (@Composable (tint: Color) -> Unit)?, modifier: Modifier = Modifier) {
    val components = NativeDesign.components
    Column(modifier, verticalArrangement = Arrangement.spacedBy(3.2.dp)) {
        val labelStyle = components.settingsRowLabel
        Row(horizontalArrangement = Arrangement.spacedBy(labelStyle.columnGap), verticalAlignment = Alignment.CenterVertically) {
            icon?.let { Box(Modifier.nativeBox(components.settingsRowLabelIcon), contentAlignment = Alignment.Center) { it(components.settingsRowLabelIcon.text.color) } }
            BasicText(label, style = labelStyle.text.textStyle())
        }
        helper?.let { BasicText(it, style = components.settingsRowHelper.text.textStyle()) }
    }
}

/**
 * Web `.range-input`: label and value on one line, a track below; drag or tap to set. [steps] is
 * the number of values between 0 and 1 inclusive (e.g. 11 for 0–100 % by 10).
 */
@Composable
fun NativeRangeSetting(
    label: String,
    value: Float,
    onValueChange: (Float) -> Unit,
    valueText: String,
    modifier: Modifier = Modifier,
    steps: Int = 101,
    icon: (@Composable (tint: Color) -> Unit)? = null,
) {
    val components = NativeDesign.components
    val colors = NativeDesign.colors
    var width by remember { mutableIntStateOf(1) }
    fun snap(x: Float): Float {
        val raw = (x / width).coerceIn(0f, 1f)
        return if (steps > 1) (raw * (steps - 1)).roundToInt() / (steps - 1).toFloat() else raw
    }
    Column(modifier.fillMaxWidth().testTag("range-input"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            val labelStyle = components.rangeLabel
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(labelStyle.columnGap), verticalAlignment = Alignment.CenterVertically) {
                icon?.let { Box(Modifier.nativeBox(components.settingsRowLabelIcon), contentAlignment = Alignment.Center) { it(components.settingsRowLabelIcon.text.color) } }
                BasicText(label, style = labelStyle.text.textStyle())
            }
            BasicText(valueText, style = components.rangeValue.text.textStyle())
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(24.dp)
                .onSizeChanged { width = it.width.coerceAtLeast(1) }
                .semantics {
                    contentDescription = label
                    stateDescription = valueText
                    progressBarRangeInfo = ProgressBarRangeInfo(value, 0f..1f, (steps - 2).coerceAtLeast(0))
                    setProgress { target ->
                        onValueChange(target.coerceIn(0f, 1f))
                        true
                    }
                }
                .pointerInput(steps) { detectTapGestures { onValueChange(snap(it.x)) } }
                .pointerInput(steps) { detectHorizontalDragGestures { change, _ -> onValueChange(snap(change.position.x)) } }
                .drawBehind {
                    val y = size.height / 2
                    val stroke = 4.dp.toPx()
                    val x = value.coerceIn(0f, 1f) * size.width
                    drawLine(colors.border, Offset(0f, y), Offset(size.width, y), stroke, StrokeCap.Round)
                    drawLine(colors.accent, Offset(0f, y), Offset(x, y), stroke, StrokeCap.Round)
                    drawCircle(colors.accent, radius = 9.dp.toPx(), center = Offset(x.coerceIn(9.dp.toPx(), size.width - 9.dp.toPx()), y))
                    drawCircle(colors.surfaceRaised, radius = 4.dp.toPx(), center = Offset(x.coerceIn(9.dp.toPx(), size.width - 9.dp.toPx()), y))
                },
        )
    }
}

/**
 * Web `.ui-feature-card`: an optional capability on ruled paper — icon tile, serif title, status
 * pill, summary, actions and folded details.
 */
@Composable
fun NativeFeatureTile(
    title: String,
    status: String,
    modifier: Modifier = Modifier,
    summary: String? = null,
    icon: (@Composable (tint: Color) -> Unit)? = null,
    actions: (@Composable RowScope.() -> Unit)? = null,
    details: (@Composable ColumnScope.() -> Unit)? = null,
    detailsTitle: String = "Подробнее",
) {
    val components = NativeDesign.components
    val card = components.uiFeatureCard
    Column(
        modifier.fillMaxWidth().testTag("ui-feature-card").nativeBoxFrame(card).nativePaperRules().nativePadding(card),
        verticalArrangement = Arrangement.spacedBy(card.rowGap),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            icon?.let { Box(Modifier.nativeBox(components.uiFeatureCardIcon), contentAlignment = Alignment.Center) { it(components.uiFeatureCardIcon.text.color) } }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.6.dp)) {
                BasicText(title, Modifier.semantics { heading() }, style = components.uiFeatureCardTitle.text.textStyle())
                val pill = components.uiFeatureCardStatus
                BasicText(status, Modifier.testTag("ui-feature-card-status").nativeBox(pill), style = pill.text.textStyle())
            }
        }
        summary?.let { BasicText(it, style = components.uiFeatureCardSummary.text.textStyle()) }
        actions?.let { Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically, content = it) }
        details?.let { NativeDisclosure(detailsTitle, content = it) }
    }
}

/** Web `.ui-button--primary`: the filled accent button. */
@Composable
fun NativePrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, icon: (@Composable (tint: Color) -> Unit)? = null) {
    val style = NativeDesign.components.buttonPrimary
    Row(
        modifier
            .testTag("button-primary")
            .nativePressBox(style, enabled, strong = true) { source -> clickable(source, null, enabled = enabled, role = Role.Button, onClick = onClick) },
        horizontalArrangement = Arrangement.spacedBy(style.columnGap),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon?.invoke(style.text.color)
        BasicText(style.text.display(text), style = style.text.textStyle(), maxLines = 1)
    }
}

/** Web `.ui-disclosure` (inline): a header row with a round chevron that folds its content. */
@Composable
fun NativeDisclosure(title: String, modifier: Modifier = Modifier, initiallyOpen: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    val components = NativeDesign.components
    var open by remember { mutableStateOf(initiallyOpen) }
    val header = components.disclosureHeader
    val chevron = components.disclosureChevron
    val turn by animateFloatAsState(if (open) 180f else 0f, tween(200), label = "disclosure")
    Column(modifier.fillMaxWidth().drawBehind {
        drawLine(components.paperSheet.borderColor, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx())
    }) {
        Row(
            Modifier
                .fillMaxWidth()
                .testTag("disclosure-header")
                .semantics { stateDescription = if (open) "Развёрнуто" else "Свёрнуто" }
                .clickable(role = Role.Button) { open = !open }
                .nativeBox(header.copy(padding = header.padding.copy(start = 0.dp, end = 0.dp))),
            horizontalArrangement = Arrangement.spacedBy(header.columnGap),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BasicText(title, Modifier.weight(1f), style = components.disclosureTitle.text.textStyle())
            Box(
                Modifier.nativeBox(chevron).rotate(turn).drawBehind {
                    val half = size.minDimension * 0.18f
                    val stroke = 1.6.dp.toPx()
                    val tip = Offset(center.x, center.y + half / 2)
                    drawLine(chevron.text.color, Offset(center.x - half, center.y - half / 2), tip, stroke, StrokeCap.Round)
                    drawLine(chevron.text.color, tip, Offset(center.x + half, center.y - half / 2), stroke, StrokeCap.Round)
                },
            )
        }
        AnimatedVisibility(open, enter = expandVertically(tween(200)) + fadeIn(tween(200)), exit = shrinkVertically(tween(160)) + fadeOut(tween(120))) {
            Column(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
        }
    }
}

/** One option of [NativeChoiceGroup]. */
data class NativeChoice(val label: String, val hint: String? = null)

/** Web `.ui-choice-group`: a legend and radio options with hints. */
@Composable
fun NativeChoiceGroup(legend: String, options: List<NativeChoice>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    val components = NativeDesign.components
    val colors = NativeDesign.colors
    Column(modifier.fillMaxWidth().selectableGroup(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        BasicText(legend, Modifier.nativePadding(components.choiceLegend), style = components.choiceLegend.text.textStyle())
        options.forEachIndexed { index, option ->
            val on = index == selected
            val row = components.choiceOption
            Row(
                Modifier.fillMaxWidth().testTag("choice-option").selectable(on, role = Role.RadioButton) { onSelect(index) },
                horizontalArrangement = Arrangement.spacedBy(row.columnGap),
            ) {
                val size = components.choiceInput.width ?: 17.6.dp
                Box(
                    Modifier
                        .padding(top = 2.dp)
                        .size(size)
                        .border(1.5.dp, if (on) colors.accent else colors.textMuted, CircleShape)
                        .clearAndSetSemantics {},
                    contentAlignment = Alignment.Center,
                ) { if (on) Box(Modifier.size(size * 0.5f).background(colors.accent, CircleShape)) }
                Column(Modifier.weight(1f)) {
                    BasicText(option.label, style = components.choiceLabel.text.textStyle())
                    option.hint?.let { BasicText(it, style = components.choiceHint.text.textStyle()) }
                }
            }
        }
    }
}

/** Web `.settings-page__link`: a small underlined mono link. */
@Composable
fun NativeTextLink(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val style = NativeDesign.components.settingsLink
    BasicText(
        text,
        modifier.clickable(role = Role.Button, onClick = onClick).padding(vertical = 6.dp),
        style = style.text.textStyle().copy(textDecoration = TextDecoration.Underline),
    )
}

/** A thin rule between rows on a paper sheet. */
@Composable
fun NativeSheetDivider(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(NativeDesign.components.paperSheet.borderColor))
}
