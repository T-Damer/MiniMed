package dev.localmed.nativespike.shared.designsystem

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.input.ImeAction

/** Web `.query-sheet`: the search field card holding the input and the controls row. */
@Composable
fun NativeQuerySheet(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxWidth().testTag("query-sheet").nativeBox(NativeDesign.components.querySheet),
        content = content,
    )
}

/** Web `[data-testid=search-input]`: the serif query text area with an optional clear control. */
@Composable
fun NativeQueryInput(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    onSubmit: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: (@Composable () -> Unit)? = null,
) {
    val style = NativeDesign.components.queryInput
    val textStyle = style.text.textStyle()
    Box(modifier.fillMaxWidth()) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth().testTag("query-input").nativeBox(style),
            textStyle = textStyle,
            cursorBrush = SolidColor(NativeDesign.colors.accent),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { onSubmit() }),
            decorationBox = { field ->
                Box {
                    if (value.isEmpty()) {
                        BasicText(placeholder, style = textStyle.copy(color = NativeDesign.colors.textFaint))
                    }
                    field()
                }
            },
        )
        if (trailing != null) {
            Box(Modifier.align(Alignment.TopEnd)) { trailing() }
        }
    }
}

/** Web `.query-actions`: the single row under the field — source picker, toggle, send. */
@Composable
fun NativeQueryActions(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    val style = NativeDesign.components.queryActions
    Row(
        modifier.fillMaxWidth().testTag("query-actions").nativeBox(style),
        horizontalArrangement = Arrangement.spacedBy(style.columnGap),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** What the query row reports while the core is not ready or a submitted query is running. */
@Immutable
data class NativeQueryProgress(
    val title: String,
    val detail: String? = null,
    /** 0–1 when the size is known, e.g. a download; null spins without a value. */
    val fraction: Float? = null,
)

/**
 * The row under the field. Native design: while the core connects (or a query submitted before it
 * was ready is running) the row trades the source picker and toggle for the status, and the send
 * button for a round progress; the field above stays editable. The web shows a separate status card.
 */
@Composable
fun NativeQueryFooter(
    progress: NativeQueryProgress?,
    modifier: Modifier = Modifier,
    controls: @Composable RowScope.() -> Unit,
) {
    AnimatedContent(
        targetState = progress != null,
        modifier = modifier.fillMaxWidth(),
        transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(140)) },
        label = "query-footer",
    ) { busy ->
        val current = progress
        if (busy && current != null) NativeQueryStatus(current) else NativeQueryActions(content = controls)
    }
}

@Composable
private fun NativeQueryStatus(progress: NativeQueryProgress) {
    val components = NativeDesign.components
    val row = components.queryActions
    val button = components.searchButton
    Row(
        Modifier.fillMaxWidth().testTag("query-status").nativeBox(row),
        horizontalArrangement = Arrangement.spacedBy(row.columnGap),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }) {
            BasicText(progress.title, style = components.coreStatusTitle.text.textStyle(), maxLines = 1)
            progress.detail?.let {
                BasicText(
                    it,
                    style = components.coreStatusDetail.text.textStyle(),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Box(Modifier.testTag("query-progress").nativeBox(button), contentAlignment = Alignment.Center) {
            val ink = button.text.color
            val indicator = Modifier.size(22.dp)
            val fraction = progress.fraction
            if (fraction == null) {
                CircularProgressIndicator(indicator, color = ink, strokeWidth = 2.5.dp, trackColor = ink.copy(alpha = 0.25f))
            } else {
                CircularProgressIndicator(
                    progress = { fraction.coerceIn(0f, 1f) },
                    modifier = indicator,
                    color = ink,
                    strokeWidth = 2.5.dp,
                    trackColor = ink.copy(alpha = 0.25f),
                )
            }
        }
    }
}
