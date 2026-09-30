package dev.localmed.nativespike.shared.designsystem

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
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
