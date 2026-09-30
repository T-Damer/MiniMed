@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package dev.localmed.nativespike.shared

import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.window.ComposeUIViewController
import dev.localmed.nativespike.shared.core.IOSNativeContentIO
import dev.localmed.nativespike.shared.core.NativeMedicalCore
import dev.localmed.nativespike.shared.content.bundledNativeCatalog
import dev.localmed.nativespike.shared.ui.NativeCoreSession
import dev.localmed.nativespike.shared.ui.NativeCoreSessionState
import dev.localmed.nativespike.shared.ui.NativeCoreStartup
import dev.localmed.nativespike.shared.ui.NativeSearchSpikeApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import platform.Foundation.NSApplicationSupportDirectory
import platform.Foundation.NSFileManager
import platform.Foundation.NSURL
import platform.Foundation.NSUserDomainMask
import platform.UIKit.UIViewController

/** Swift hosts the shared native UI; content stays inside this application's sandbox. */
fun nativeViewController(): UIViewController = ComposeUIViewController {
    val scope = remember { CoroutineScope(SupervisorJob() + Dispatchers.Main) }
    val io = remember {
        val directory = NSFileManager.defaultManager.URLsForDirectory(
            NSApplicationSupportDirectory,
            NSUserDomainMask,
        ).firstOrNull() as? NSURL ?: error("Локальное хранилище недоступно")
        IOSNativeContentIO("${directory.path ?: error("Локальное хранилище недоступно")}/MiniMed")
    }
    val session = remember { NativeCoreSession(io, ::bundledNativeCatalog, scope) }
    val state by session.state.collectAsState()
    LaunchedEffect(session) {
        if (NativeMedicalCore.hasCachedCore(io)) session.retry()
    }
    DisposableEffect(session) {
        onDispose {
            scope.launch(NonCancellable) {
                try {
                    session.close()
                } finally {
                    scope.cancel()
                }
            }
        }
    }
    when (val current = state) {
        is NativeCoreSessionState.Opening -> NativeCoreStartup(current.progress, null, session::retry)
        is NativeCoreSessionState.Failed -> NativeCoreStartup(null, current.message, session::retry)
        is NativeCoreSessionState.Ready -> NativeSearchSpikeApp(core = current.core, actionScope = scope, uiErrors = session.uiErrors, session = session)
    }
}
