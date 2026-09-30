package dev.localmed.nativespike.shared.designsystem

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics

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
            .nativeBoxFrame(style)
            .semantics { this.contentDescription = contentDescription }
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .nativePadding(style),
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
            .nativeBoxFrame(style)
            .semantics { contentDescription = label }
            .toggleable(value = checked, role = Role.Switch, onValueChange = onCheckedChange)
            .nativePadding(style),
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
            .nativeBoxFrame(style)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .nativePadding(style),
        horizontalArrangement = Arrangement.spacedBy(style.columnGap, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon?.invoke(style.text.color)
        BasicText(style.text.display(text), style = style.text.textStyle())
    }
}

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
            .nativeBoxFrame(style)
            .clickable(role = Role.DropdownList, onClick = onClick)
            .nativePadding(style),
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
        modifier.testTag("quick-access-chip").nativeBoxFrame(style).clickable(role = Role.Button, onClick = onClick).nativePadding(style),
        horizontalArrangement = Arrangement.spacedBy(style.columnGap),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon?.invoke(style.text.color)
        BasicText(style.text.display(label), style = style.text.textStyle(), maxLines = 1)
    }
}
