package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.user.NativeThemePreference
import dev.localmed.nativespike.shared.user.NativeHistoryAnalysisMode
import dev.localmed.nativespike.shared.user.NATIVE_TEXT_SCALE_LEVELS
import dev.localmed.nativespike.shared.user.NativeUserSnapshot
import kotlinx.coroutines.launch

@Composable
private fun NativeUserError(session: NativeCoreSession) {
    val errors by session.uiErrors.messages.collectAsState()
    val pending by session.historyPending.collectAsState()
    val snapshot by session.userState.snapshot.collectAsState()
    errors[NativeUiOperation.UserState]?.let { message ->
        Text(message, color = MaterialTheme.colorScheme.error)
        if (snapshot == null && !pending) TextButton(onClick = { session.actionScope.launch { session.loadUserState() } }) {
                Text("Повторить чтение")
            }
    }
    listOf(NativeUiOperation.UserPreferences, NativeUiOperation.UserHistory).forEach { operation ->
        errors[operation]?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
    if (pending) TextButton(onClick = { session.actionScope.launch { session.retryHistory() } }) { Text("Повторить сохранение истории") }
    errors[NativeUiOperation.Navigation]?.let { Text(it, color = MaterialTheme.colorScheme.error) }
}

@Composable
fun NativeSettingsScreen(session: NativeCoreSession, snapshot: NativeUserSnapshot?) {
    var saving by remember(session) { mutableStateOf(false) }
    val save = { operation: suspend () -> Unit ->
        if (!saving && snapshot != null) {
            saving = true
            session.actionScope.launch {
                try {
                    session.uiErrors.execute(NativeUiOperation.UserPreferences, "Не удалось сохранить настройку. Выберите значение ещё раз.") {
                        operation()
                    }
                } finally { saving = false }
            }
        }
        Unit
    }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Column(Modifier.statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Настройки", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 12.dp))
                TextButton(onClick = { session.actionScope.launch { session.back() } }) { Text("Назад") }
            }
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item { Column(Modifier.padding(horizontal = 16.dp)) { NativeUserError(session) } }
                if (snapshot != null) {
                    item { Text("Тема", modifier = Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.titleMedium) }
                    items(NativeThemePreference.entries) { theme ->
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                            RadioButton(selected = snapshot.preferences.theme == theme, enabled = !saving,
                                onClick = { save { session.userState.setTheme(theme) } })
                            TextButton(enabled = !saving, onClick = { save { session.userState.setTheme(theme) } }) {
                                Text(when (theme) { NativeThemePreference.System -> "Системная"; NativeThemePreference.Light -> "Светлая"; NativeThemePreference.Dark -> "Тёмная" })
                            }
                        }
                    }
                    item { Text("Размер текста", modifier = Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.titleMedium) }
                    item { Text("Применяется поверх системного размера шрифта.", modifier = Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    items(NATIVE_TEXT_SCALE_LEVELS) { scale ->
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                            RadioButton(selected = snapshot.preferences.textScalePercent == scale, enabled = !saving,
                                onClick = { save { session.userState.setTextScalePercent(scale) } })
                            TextButton(enabled = !saving, onClick = { save { session.userState.setTextScalePercent(scale) } }) { Text("$scale %") }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NativeHistoryDrawer(session: NativeCoreSession, snapshot: NativeUserSnapshot?) {
    var clearing by remember(session) { mutableStateOf(false) }
    var saving by remember(session) { mutableStateOf(false) }
    val mutate = { operation: suspend () -> Unit ->
        if (!saving) { saving = true; session.actionScope.launch {
            try { session.uiErrors.execute(NativeUiOperation.UserHistory, "Не удалось изменить историю. Повторите действие.", operation) }
            finally { saving = false }
        } }
        Unit
    }
    ModalBottomSheet(onDismissRequest = { session.actionScope.launch { session.back() } }, containerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("История поиска", style = MaterialTheme.typography.titleLarge)
                TextButton(enabled = !saving && !snapshot?.history.isNullOrEmpty(), onClick = { clearing = true }) { Text("Очистить") }
            }
            NativeUserError(session)
            if (snapshot?.history?.isEmpty() == true) Text("Завершённые поиски появятся здесь.", modifier = Modifier.padding(vertical = 16.dp))
            LazyColumn(Modifier.fillMaxWidth().weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(snapshot?.history.orEmpty(), key = { it.id }) { entry ->
                    Column(Modifier.fillMaxWidth()) {
                        Text(entry.query, style = MaterialTheme.typography.titleMedium)
                        Text("База поиска · ${if (entry.analysisMode == NativeHistoryAnalysisMode.Clinical) "клинический запрос" else "по названию"} · лексический поиск · найдено групп: ${entry.resultCount}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(entry.createdAt, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row {
                            TextButton(enabled = !saving, onClick = { session.actionScope.launch { session.replay(entry) } }) { Text("Повторить поиск") }
                            TextButton(enabled = !saving, onClick = { mutate { session.deleteHistory(entry.id) } }) { Text("Удалить") }
                        }
                    }
                }
            }
        }
    }
    if (clearing) AlertDialog(onDismissRequest = { clearing = false }, title = { Text("Очистить историю поиска?") },
        text = { Text("Будут удалены только сохранённые запросы. Источники и текущий поиск останутся.") },
        confirmButton = { TextButton(enabled = !saving, onClick = { mutate { session.clearHistory(); clearing = false } }) { Text("Очистить") } },
        dismissButton = { TextButton(onClick = { clearing = false }) { Text("Отмена") } })
}
