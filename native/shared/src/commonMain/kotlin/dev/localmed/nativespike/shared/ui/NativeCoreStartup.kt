package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import dev.localmed.nativespike.shared.designsystem.NativeQueryProgress
import kotlinx.coroutines.launch
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.core.NativeInstallProgress
import dev.localmed.nativespike.shared.text.formatFixed1

fun nativeProgressLabel(progress: NativeInstallProgress?): String = when (progress?.stage) {
    "download" -> "Загружаем источники"
    "validate" -> "Проверяем загруженную базу"
    "decode" -> "Распаковываем базу"
    else -> "Открываем базу источников"
}

@Composable
fun NativeInstallProgressView(progress: NativeInstallProgress?) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(nativeProgressLabel(progress), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
        val total = progress?.totalBytes
        val received = progress?.receivedBytes ?: 0
        if (progress?.stage == "download" && total != null && total > 0) {
            LinearProgressIndicator(progress = { (received.toDouble() / total).coerceIn(0.0, 1.0).toFloat() }, modifier = Modifier.fillMaxWidth())
            Text("${formatFixed1(received / 1048576.0)} / ${formatFixed1(total / 1048576.0)} МБ",
                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
fun NativeCoreStartup(session: NativeCoreSession, progress: NativeInstallProgress?, error: String?) {
    val tools by session.tools.collectAsState()
    val messages by session.uiErrors.messages.collectAsState()
    val idle = progress == null && error == null
    val total = progress?.totalBytes
    val fraction = if (total != null && total > 0) (progress.receivedBytes.toDouble() / total).coerceIn(0.0, 1.0).toFloat()
        else if (idle || error != null) 0f else null
    SearchScreen(
        core = null,
        state = session.startupSearch,
        onOpenDocument = { _, _, _, _ -> },
        onOpenSources = {},
        onOpenIdentity = {},
        toolCore = tools,
        onOpenTools = { session.actionScope.launch { session.openTools() }; Unit },
        onOpenToolSection = { kind -> session.actionScope.launch { session.openTools(kind) }; Unit },
        onOpenTool = { record -> session.actionScope.launch { session.openTool(record.id) }; Unit },
        onSaveTool = { item -> session.actionScope.launch { session.openCollections(item) }; Unit },
        coreProgress = NativeQueryProgress(
            title = when { error != null -> "База недоступна"; idle -> "База не установлена"; else -> nativeProgressLabel(progress) },
            detail = if (idle) "Загрузите базу для поиска без интернета" else null,
            fraction = fraction,
        ),
        coreError = error,
        sourceError = messages[NativeUiOperation.ToolsState],
        onRetryCore = if (idle || error != null) session::retry else null,
        retryCoreLabel = if (idle) "Загрузить базу" else "Повторить чтение базы",
    )
}
