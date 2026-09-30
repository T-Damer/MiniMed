package dev.localmed.nativespike.desktopapp

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.WindowPosition
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import dev.localmed.nativespike.shared.content.JVMContentIO
import dev.localmed.nativespike.shared.content.bundledNativeCatalog
import dev.localmed.nativespike.shared.content.bundledNativeTools
import dev.localmed.nativespike.shared.core.NativeMedicalCore
import dev.localmed.nativespike.shared.ui.NativeCoreSession
import dev.localmed.nativespike.shared.ui.NativeCoreSessionState
import dev.localmed.nativespike.shared.ui.NativeSessionShell
import dev.localmed.nativespike.shared.ui.NativeSearchSpikeApp
import dev.localmed.nativespike.shared.ui.NativeUiOperation
import java.io.File
import kotlinx.coroutines.launch

fun main() = application {
    val scope = rememberCoroutineScope()
    val io = remember {
        val root = System.getenv("MINIMED_NATIVE_DATA_DIR")
            ?: File(System.getProperty("user.home"), ".minimed-native-spike").absolutePath
        JVMContentIO(root)
    }
    val session = remember { NativeCoreSession(io, { bundledNativeCatalog() }, scope, ::bundledNativeTools) }
    var closing by remember { mutableStateOf(false) }
    LaunchedEffect(session) { if (NativeMedicalCore.hasCachedCore(io)) session.retry() }
    val windowState = rememberWindowState(size = DpSize(480.dp, 900.dp), position = WindowPosition(Alignment.Center))
    Window(
        onCloseRequest = {
            if (!closing) {
                closing = true
                scope.launch {
                    if (!session.flushUi()) { closing = false; return@launch }
                    val closed = session.uiErrors.execute(NativeUiOperation.Navigation, "Не удалось закрыть источники. Повторите закрытие.") { session.close() }
                    if (closed) exitApplication() else closing = false
                }
            }
        },
        title = "MiniMed Native", state = windowState,
        onPreviewKeyEvent = { event ->
            val core = (session.state.value as? NativeCoreSessionState.Ready)?.core
            if (event.type == KeyEventType.KeyDown && event.key == Key.Escape && (session.panel.value != null || session.toolsState.snapshot.value?.route != null || (core != null && (core.navigation.value.readers.isNotEmpty() || core.navigation.value.catalog != null)))) {
                scope.launch { session.back() }; true
            } else false
        },
    ) {
        NativeSessionShell(session) { current ->
            NativeSearchSpikeApp(current.core, actionScope = scope, uiErrors = session.uiErrors, session = session)
        }
    }
}
