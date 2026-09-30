package dev.localmed.nativespike.shared.designsystem

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** Web `.archive-search__control`: a paper search field with a leading icon and a serif query. */
@Composable
fun NativeSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    onSearch: () -> Unit = {},
    icon: @Composable (tint: Color) -> Unit,
) {
    val components = NativeDesign.components
    val field = components.searchField
    val input = components.searchFieldInput
    Row(
        modifier.fillMaxWidth().testTag("search-field").nativeBox(field),
        horizontalArrangement = Arrangement.spacedBy(field.columnGap),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val iconStyle = components.searchFieldIcon
        Box(Modifier.alpha(iconStyle.opacity).size(20.dp), contentAlignment = Alignment.Center) { icon(iconStyle.text.color) }
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            val text = input.text.textStyle()
            if (value.isEmpty()) BasicText(placeholder, style = text.copy(color = NativeDesign.colors.textFaint), maxLines = 1)
            BasicTextField(
                value,
                onValueChange,
                Modifier.fillMaxWidth().semantics { contentDescription = placeholder },
                singleLine = true,
                textStyle = text,
                cursorBrush = SolidColor(NativeDesign.colors.accent),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { onSearch() }),
            )
        }
    }
}

/** One step of [NativeBreadcrumbs]. */
data class NativeCrumb(val label: String, val icon: (@Composable (tint: Color) -> Unit)? = null)

/** Web `.user-library-breadcrumbs`: a sunken bar of path steps; the last one is raised and current. */
@Composable
fun NativeBreadcrumbs(crumbs: List<NativeCrumb>, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    val components = NativeDesign.components
    val bar = components.breadcrumbs
    Row(
        modifier.fillMaxWidth().testTag("breadcrumbs").nativeBox(bar).horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(bar.columnGap),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        crumbs.forEachIndexed { index, crumb ->
            val current = index == crumbs.lastIndex
            val style = if (current) components.breadcrumbActive else components.breadcrumbActive.copy(background = Color.Transparent, shadows = emptyList())
            val color = if (current) components.breadcrumbLabel.text.color else bar.text.color
            if (index > 0) BasicText("/", style = components.breadcrumbLabel.text.textStyle().copy(color = bar.text.color))
            Row(
                Modifier.nativeBoxFrame(style).clickable(enabled = !current, role = Role.Button) { onSelect(index) }.nativePadding(style),
                horizontalArrangement = Arrangement.spacedBy(style.columnGap),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                crumb.icon?.invoke(color)
                BasicText(crumb.label, style = components.breadcrumbLabel.text.textStyle().copy(color = color), maxLines = 1)
            }
        }
    }
}

/**
 * Web `.user-library-view-toggle`: a pill of icon choices with an accent thumb that slides to the
 * chosen one.
 */
@Composable
fun NativeIconToggle(
    options: List<Pair<String, @Composable (tint: Color) -> Unit>>,
    selected: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val components = NativeDesign.components
    val pill = components.viewToggle
    val thumb = components.viewToggleThumb
    val width = thumb.width ?: 40.dp
    val shift by animateDpAsState(width * selected, tween(180), label = "toggle-thumb")
    Box(modifier.testTag("view-toggle").nativeBox(pill).selectableGroup()) {
        Box(Modifier.offset(x = shift).nativeBoxFrame(thumb))
        Row {
            options.forEachIndexed { index, (label, icon) ->
                val on = index == selected
                val style = if (on) components.viewToggleButtonOn else components.viewToggleButton
                Box(
                    Modifier
                        .semantics { contentDescription = label }
                        .nativeBoxFrame(style.copy(background = Color.Transparent))
                        .selectable(on, role = Role.RadioButton) { onSelect(index) },
                    contentAlignment = Alignment.Center,
                ) { icon(style.text.color) }
            }
        }
    }
}

/**
 * Web `.user-library-folder-card`: a paper tile with a drawn folder (back sheet, tab, front sheet
 * in the folder gradient) carrying the section icon, then the title, a pin and the details line.
 */
@Composable
fun NativeFolderCard(
    title: String,
    details: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    pinned: Boolean = false,
    icon: (@Composable (tint: Color) -> Unit)? = null,
    pin: (@Composable (tint: Color) -> Unit)? = null,
) {
    val components = NativeDesign.components
    val card = components.folderCard
    Column(
        modifier
            .testTag("folder-card")
            .nativeBoxFrame(card)
            .clickable(role = Role.Button, onClick = onClick)
            .nativePadding(card)
            .padding(horizontal = 4.dp, vertical = 18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        NativeFolderFigure(icon)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            BasicText(
                title,
                Modifier.weight(1f, fill = false),
                style = components.folderCardTitle.text.textStyle().copy(textAlign = TextAlign.Center),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (pinned) pin?.let { Box(Modifier.nativeBox(components.folderCardPin), contentAlignment = Alignment.Center) { it(components.folderCardPin.text.color) } }
        }
        BasicText(details, style = components.folderCardDetails.text.textStyle().copy(textAlign = TextAlign.Center), maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

/** The folder drawing: a back sheet with a tab behind a front sheet, both in the folder gradient. */
@Composable
fun NativeFolderFigure(icon: (@Composable (tint: Color) -> Unit)?, modifier: Modifier = Modifier) {
    val components = NativeDesign.components
    val figure = components.folderCardFigure
    val gradient = Brush.verticalGradient(listOf(FOLDER_TOP, FOLDER_BOTTOM))
    Box(modifier.size(figure.width ?: 112.dp, figure.height ?: 72.dp)) {
        // Tab on the back sheet, left of centre as in the web drawing.
        Box(Modifier.offset(x = 14.dp).size(36.dp, 14.dp).background(gradient, RoundedCornerShape(topStart = 6.dp, topEnd = 6.dp)))
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(63.4.dp).background(gradient, RoundedCornerShape(10.4.dp)))
        Box(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(57.dp).background(gradient, RoundedCornerShape(5.6.dp)),
            contentAlignment = Alignment.Center,
        ) {
            icon?.let { Box(Modifier.size(components.folderCardIcon.width ?: 24.dp), contentAlignment = Alignment.Center) { it(components.folderCardIcon.text.color) } }
        }
    }
}

private val FOLDER_TOP = Color(0xFFCBB37C)
private val FOLDER_BOTTOM = Color(0xFF8F7849)
