package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
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
    NativeChromeScaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = {
        Row(Modifier.fillMaxWidth().statusBarsPadding().heightIn(min = 56.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            NativePaperIconButton(NativeAppGlyphName.ArrowLeft, onBack, "Назад", primary = true)
        }
    }) { padding ->
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding()) {
            Spacer(Modifier.height(padding.calculateTopPadding()))
            NativePaperSurface(Modifier.fillMaxWidth().padding(20.dp), raised = false) {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    when {
                        download != null -> {
                            Text(download.title, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurface)
                            Text("Источник доступен в дополнительном наборе. После установки его можно читать без интернета.",
                                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
                            Text("Размер загрузки: ${formatFixed1(download.bytes / 1048576.0)} МБ",
                                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (installing) NativeInstallProgressView(progress)
                            else NativePaperButton(if (error == null) "Загрузить источник" else "Повторить загрузку", onInstall, primary = true, glyph = NativeAppGlyphName.Download)
                        }
                        reason != null -> {
                            Text(reason, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
                            NativePaperButton("Проверить снова", onRetry)
                        }
                        resolution == null -> NativeInstallProgressView(null)
                    }
                    error?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface) }
                }
            }
        }
    }
}

private data class ReaderDownload(val title: String, val bytes: Long)
