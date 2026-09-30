package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import dev.localmed.nativespike.shared.designsystem.NativeClinicalToggle
import dev.localmed.nativespike.shared.designsystem.NativeDesign
import dev.localmed.nativespike.shared.designsystem.NativeDimensions
import dev.localmed.nativespike.shared.designsystem.NativeIconButton
import dev.localmed.nativespike.shared.designsystem.NativeQueryFooter
import dev.localmed.nativespike.shared.designsystem.NativeQueryProgress
import dev.localmed.nativespike.shared.designsystem.NativeQueryInput
import dev.localmed.nativespike.shared.designsystem.NativeQuerySheet
import dev.localmed.nativespike.shared.model.NativeSearchMode
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.onPreviewKeyEvent

/** The same query sheet and one controls row in every native host, including Wasm. */
@Composable
internal fun NativeSearchControls(state: NativeSearchUiState, focus: FocusRequester, coreReady: Boolean = true, coreProgress: NativeQueryProgress? = null) {
    val components = NativeDesign.components
    val submit = { state.submit(waitingForCore = !coreReady) }
    val progress = if (state.loading || state.queuedQuery != null) NativeQueryProgress("Ищем…", coreProgress?.detail ?: coreProgress?.title) else coreProgress
    NativeQuerySheet {
        NativeQueryInput(
            value = state.query,
            onValueChange = state::updateQuery,
            placeholder = if (state.mode == NativeSearchMode.CLINICAL) "Например: 5 лет, мальчик, второй день кашляет и температурит…" else "Название, код МКБ, препарат или фраза из документа",
            onSubmit = submit,
            modifier = Modifier.focusRequester(focus).semantics { contentDescription = "Поисковый запрос" }.onPreviewKeyEvent { event ->
                if (event.type == KeyEventType.KeyDown && event.key == Key.Enter && !event.isShiftPressed &&
                    (state.mode == NativeSearchMode.LOOKUP || event.isCtrlPressed || event.isMetaPressed)) {
                    submit(); true
                } else false
            },
            trailing = if (state.query.isEmpty()) null else {
                {
                    NativeIconButton(components.queryClear, "query-sheet__clear", "Очистить запрос", { state.updateQuery("") }) {
                        NativeAppGlyph(NativeAppGlyphName.Close, Modifier.size(NativeDimensions.space4), it)
                    }
                }
            },
        )
        NativeQueryFooter(progress) {
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(components.queryActions.columnGap), verticalAlignment = Alignment.CenterVertically) {
            NativeSearchScopePicker(state.selection.scope, Modifier.weight(1f, fill = false)) { scope -> state.updateSelection(state.selection.copy(scope = scope)) }
            NativeClinicalToggle(
                checked = state.mode == NativeSearchMode.CLINICAL,
                onCheckedChange = { state.updateMode(if (it) NativeSearchMode.CLINICAL else NativeSearchMode.LOOKUP) },
                label = "Клинический разбор",
            ) { tint, _ -> NativeAppGlyph(NativeAppGlyphName.Brain, Modifier.size(NativeDimensions.space5), tint) }
            }
            NativeIconButton(
                components.searchButton, "search-button", if (state.loading) "Ищем" else "Найти или повторить поиск",
                submit, enabled = state.query.isNotBlank() && !state.loading,
            ) { tint -> NativeAppGlyph(NativeAppGlyphName.ArrowUp, Modifier.size(NativeDimensions.space5), tint) }
        }
    }
}
