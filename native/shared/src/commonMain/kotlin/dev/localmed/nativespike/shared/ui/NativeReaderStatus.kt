package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.Surface
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.core.NativeDocumentResolution
import dev.localmed.nativespike.shared.core.NativeDefinitionResolution
import dev.localmed.nativespike.shared.core.NativeInstallProgress
import dev.localmed.nativespike.shared.core.NativeReaderResolution
import dev.localmed.nativespike.shared.text.formatFixed1

@Composable
fun NativeReaderStatus(
    resolution: NativeReaderResolution?, progress: NativeInstallProgress?, error: String?,
    installing: Boolean, onBack: () -> Unit, onRetry: () -> Unit, onInstall: () -> Unit,
) {
    val download = when (resolution) {
        is NativeReaderResolution.Document -> (resolution.resolution as? NativeDocumentResolution.Download)?.let { ReaderDownload(it.title, it.downloadBytes) }
        is NativeReaderResolution.Definition -> (resolution.resolution as? NativeDefinitionResolution.Download)?.let { ReaderDownload(it.title, it.downloadBytes) }
        null -> null
    }
    val reason = when (resolution) {
        is NativeReaderResolution.Document -> (resolution.resolution as? NativeDocumentResolution.Unavailable)?.reason
        is NativeReaderResolution.Definition -> (resolution.resolution as? NativeDefinitionResolution.Unavailable)?.reason
        null -> null
    }
    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().statusBarsPadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            TextButton(onClick = onBack) { Text("Назад") }
            when {
                download != null -> {
                    Text(download.title, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurface)
                    Text("Источник доступен в дополнительном наборе. После установки его можно читать без интернета.",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
                    Text("Размер загрузки: ${formatFixed1(download.bytes / 1048576.0)} МБ",
                        style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (installing) NativeInstallProgressView(progress)
                    else Button(onClick = onInstall) { Text(if (error == null) "Загрузить источник" else "Повторить загрузку") }
                }
                reason != null -> {
                    Text(reason, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
                    Button(onClick = onRetry) { Text("Проверить снова") }
                }
                resolution == null -> NativeInstallProgressView(null)
            }
            error?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface) }
        }
    }
}

private data class ReaderDownload(val title: String, val bytes: Long)
