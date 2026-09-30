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
fun NativeCoreStartup(progress: NativeInstallProgress?, error: String?, onRetry: () -> Unit) {
    NativeSpikeTheme {
        Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxSize()) {
            Column(Modifier.statusBarsPadding().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("MiniMed", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurface)
                if (error == null && progress == null) {
                    Text("Загрузите базу источников. После установки поиск и чтение работают без интернета.",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
                    Button(onClick = onRetry) { Text("Загрузить базу") }
                } else if (error == null) {
                    NativeInstallProgressView(progress)
                } else {
                    Text("Не удалось подготовить базу", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                    Text(error, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
                    Button(onClick = onRetry) { Text("Повторить") }
                }
            }
        }
    }
}
