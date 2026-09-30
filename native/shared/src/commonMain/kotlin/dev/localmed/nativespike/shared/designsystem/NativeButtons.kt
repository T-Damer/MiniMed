package dev.localmed.nativespike.shared.designsystem

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp

private const val DISABLED_ALPHA = 0.55f

/**
 * A round web icon control. [style] is one of the generated round blocks — `routeIconButton`,
 * `historyFab`, `helpIconLink`, `carouselArrow`, `queryClear`, `searchButton` — and [tag] is its
 * reference key, so the parity check can find it.
 */
@Composable
fun NativeIconButton(
    style: NativeBoxStyle,
    tag: String,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: @Composable (tint: Color) -> Unit,
) {
    Box(
        modifier
            .testTag(tag)
            .alpha(if (enabled) 1f else DISABLED_ALPHA)
            .semantics { this.contentDescription = contentDescription }
            .nativePressBox(style, enabled) { source -> clickable(source, null, enabled = enabled, role = Role.Button, onClick = onClick) },
        contentAlignment = Alignment.Center,
    ) { icon(style.text.color) }
}

/** Web `.search-clinical-toggle`: an icon switch; on and off are separate captured blocks. */
@Composable
fun NativeClinicalToggle(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    icon: @Composable (tint: Color, checked: Boolean) -> Unit,
) {
    val components = NativeDesign.components
    val style = if (checked) components.clinicalToggleOn else components.clinicalToggle
    Box(
        modifier
            .testTag(if (checked) "clinical-toggle-on" else "clinical-toggle")
            .semantics { contentDescription = label }
            .nativePressBox(style) { source -> toggleable(value = checked, interactionSource = source, indication = null, role = Role.Switch, onValueChange = onCheckedChange) },
        contentAlignment = Alignment.Center,
    ) { icon(style.text.color, checked) }
}

/** Web `.home-feature__action` (primary) and `--secondary`: a labelled action button. */
@Composable
fun NativeActionButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    primary: Boolean = true,
    enabled: Boolean = true,
    icon: (@Composable (tint: Color) -> Unit)? = null,
) {
    val components = NativeDesign.components
    val style = if (primary) components.featureActionPrimary else components.featureActionSecondary
    Row(
        modifier
            .testTag(if (primary) "feature-action-primary" else "feature-action-secondary")
            .alpha(if (enabled) 1f else DISABLED_ALPHA)
            .nativePressBox(style, enabled, strong = primary) { source -> clickable(source, null, enabled = enabled, role = Role.Button, onClick = onClick) },
        horizontalArrangement = Arrangement.spacedBy(style.columnGap, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon?.invoke(style.text.color)
        // Equal-width row buttons shrink a long label a little before ellipsizing it.
        BasicText(
            style.text.display(text),
            modifier = Modifier.weight(1f, fill = false),
            style = style.text.textStyle(),
            maxLines = 1,
            autoSize = TextAutoSize.StepBased(minFontSize = MIN_ACTION_LABEL_SIZE, maxFontSize = style.text.size),
        )
    }
}

private val MIN_ACTION_LABEL_SIZE = 11.sp

/** Web `.search-source-picker`: the source scope chip under the query field. */
@Composable
fun NativeSourcePicker(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    leadingIcon: @Composable (tint: Color) -> Unit,
    trailingIcon: @Composable (tint: Color) -> Unit,
) {
    val style = NativeDesign.components.sourcePicker
    Row(
        modifier
            .testTag("source-picker")
            .nativePressBox(style) { source -> clickable(source, null, role = Role.DropdownList, onClick = onClick) },
        horizontalArrangement = Arrangement.spacedBy(style.columnGap),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        leadingIcon(style.text.color)
        BasicText(style.text.display(label), style = style.text.textStyle(), maxLines = 1)
        trailingIcon(style.text.color)
    }
}

/** Web `.search-quick-access__all`: an outlined pill chip. */
@Composable
fun NativeChip(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: (@Composable (tint: Color) -> Unit)? = null,
) {
    val style = NativeDesign.components.quickAccessChip
    Row(
        modifier.testTag("quick-access-chip").nativePressBox(style) { source -> clickable(source, null, role = Role.Button, onClick = onClick) },
        horizontalArrangement = Arrangement.spacedBy(style.columnGap),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon?.invoke(style.text.color)
        BasicText(style.text.display(label), style = style.text.textStyle(), maxLines = 1)
    }
}
