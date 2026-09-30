package dev.localmed.nativespike.shared.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.localmed.nativespike.shared.core.NativeDefinitionResolution
import dev.localmed.nativespike.shared.core.NativeDocumentResolution
import dev.localmed.nativespike.shared.core.NativeMedicalCore
import dev.localmed.nativespike.shared.core.NativeReaderResolution
import dev.localmed.nativespike.shared.core.NativeReaderRoute
import dev.localmed.nativespike.shared.core.NativeReaderTarget
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

@Composable
fun NativeReaderPane(
    core: NativeMedicalCore, reader: NativeReaderRoute, uiErrors: NativeUiErrors,
    actionScope: CoroutineScope, onBack: () -> Unit, onContentInstalled: () -> Unit,
    registerNavigationFlush: ((suspend () -> Boolean) -> (() -> Unit))? = null,
) {
    val progress by core.installProgress.collectAsState()
    val installFailure by core.installFailure.collectAsState()
    val failures by uiErrors.messages.collectAsState()
    var resolution by remember(core) { mutableStateOf<NativeReaderResolution?>(null) }
    var resolutionTarget by remember(core) { mutableStateOf<NativeReaderTarget?>(null) }
    var readerError by remember(core) { mutableStateOf<String?>(null) }
    var resolutionAttempt by remember(core) { mutableStateOf(0) }
    var installingTarget by remember(core) { mutableStateOf<NativeReaderTarget?>(null) }
    LaunchedEffect(core, reader.target, resolutionAttempt, progress == null) {
        val target = reader.target
        if (progress != null && resolutionTarget == target && resolution != null) return@LaunchedEffect
        resolutionTarget = target
        resolution = null
        readerError = null
        try {
            val loaded = core.restoreReader()
            if (core.navigation.value.readers.lastOrNull()?.target == target) resolution = loaded
        } catch (cause: CancellationException) { throw cause }
        catch (cause: Exception) {
            if (core.navigation.value.readers.lastOrNull()?.target == target) {
                readerError = "Не удалось открыть источник. Повторите попытку."
                resolution = when (reader) {
                    is NativeReaderRoute.Document -> NativeReaderResolution.Document(NativeDocumentResolution.Unavailable("Не удалось открыть источник."))
                    is NativeReaderRoute.Definition -> NativeReaderResolution.Definition(NativeDefinitionResolution.Unavailable("Не удалось открыть источник."))
                }
            }
        }
    }
    val current = if (resolutionTarget == reader.target) resolution else null
    val document = (current as? NativeReaderResolution.Document)?.resolution as? NativeDocumentResolution.Readable
    val definition = (current as? NativeReaderResolution.Definition)?.resolution as? NativeDefinitionResolution.Readable
    val positionError = listOfNotNull(readerError, failures[NativeUiOperation.Navigation], failures[NativeUiOperation.ReaderPosition]).distinct().joinToString("\n").ifBlank { null }
    val savePosition: suspend (NativeReaderRoute) -> Boolean = { route ->
        uiErrors.execute(NativeUiOperation.ReaderPosition, "Не удалось сохранить позицию чтения.") { core.saveReaderSnapshot(route) }
    }
    when {
        reader is NativeReaderRoute.Document && document != null -> ReaderScreen(document.document, reader,
            error = positionError, saveFailed = failures[NativeUiOperation.ReaderPosition] != null,
            onSavePosition = savePosition, onBack = onBack, registerNavigationFlush = registerNavigationFlush)
        reader is NativeReaderRoute.Definition && definition != null -> NativeDefinitionReaderScreen(core, definition.card, reader,
            error = positionError, saveFailed = failures[NativeUiOperation.ReaderPosition] != null,
            onSavePosition = savePosition, onBack = onBack, registerNavigationFlush = registerNavigationFlush)
        else -> NativeReaderStatus(current, progress,
            error = listOfNotNull(readerError, installFailure?.takeIf { it.target == reader.target }?.message,
                failures[NativeUiOperation.Navigation]).distinct().joinToString("\n").ifBlank { null },
            installing = installingTarget != null || progress != null,
            onBack = onBack, onRetry = { resolutionAttempt += 1 }, onInstall = {
                val downloadable = (current as? NativeReaderResolution.Document)?.resolution is NativeDocumentResolution.Download ||
                    (current as? NativeReaderResolution.Definition)?.resolution is NativeDefinitionResolution.Download
                if (downloadable && installingTarget == null && progress == null) {
                    val target = reader.target
                    installingTarget = target
                    readerError = null
                    actionScope.launch {
                        try {
                            val installed = when (reader) {
                                is NativeReaderRoute.Document -> NativeReaderResolution.Document(core.install(reader.target))
                                is NativeReaderRoute.Definition -> NativeReaderResolution.Definition(core.installDefinition(reader.target))
                            }
                            onContentInstalled()
                            if (core.navigation.value.readers.lastOrNull()?.target == target) resolution = installed
                        } catch (cause: CancellationException) { throw cause }
                        catch (cause: Exception) {
                            if (core.navigation.value.readers.lastOrNull()?.target == target) readerError = "Не удалось загрузить источник. Повторите попытку."
                        } finally { installingTarget = null }
                    }
                }
            })
    }
}
