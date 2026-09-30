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
import dev.localmed.nativespike.shared.core.NativeInstallProgress
import dev.localmed.nativespike.shared.text.formatFixed1

@Composable
fun NativeDocumentStatus(
    resolution: NativeDocumentResolution?, progress: NativeInstallProgress?, error: String?,
    installing: Boolean, onBack: () -> Unit, onRetry: () -> Unit, onInstall: () -> Unit,
) {
    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().statusBarsPadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            TextButton(onClick = onBack) { Text("Назад") }
            when (resolution) {
                is NativeDocumentResolution.Download -> {
                    Text(resolution.title, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurface)
                    Text("Источник доступен в дополнительном наборе. После установки его можно читать без интернета.",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
                    Text("Размер загрузки: ${formatFixed1(resolution.downloadBytes / 1048576.0)} МБ",
                        style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (installing) NativeInstallProgressView(progress)
                    else Button(onClick = onInstall) { Text(if (error == null) "Загрузить источник" else "Повторить загрузку") }
                }
                is NativeDocumentResolution.Unavailable -> {
                    Text(resolution.reason, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
                    Button(onClick = onRetry) { Text("Проверить снова") }
                }
                null -> NativeInstallProgressView(null)
                is NativeDocumentResolution.Readable -> Unit
            }
            error?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface) }
        }
    }
}
