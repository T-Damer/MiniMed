package dev.localmed.nativespike.app

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.setContent
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModelProvider
import dev.localmed.nativespike.shared.content.JVMContentIO
import dev.localmed.nativespike.shared.content.bundledNativeCatalog
import dev.localmed.nativespike.shared.content.bundledNativeTools
import dev.localmed.nativespike.shared.core.NativeMedicalCore
import dev.localmed.nativespike.shared.ui.NativeCoreSession
import dev.localmed.nativespike.shared.ui.NativeCoreSessionState
import dev.localmed.nativespike.shared.ui.NativeSessionShell
import dev.localmed.nativespike.shared.ui.nativeUserDarkTheme
import dev.localmed.nativespike.shared.user.NativeThemePreference
import dev.localmed.nativespike.shared.ui.NativeSearchSpikeApp
import dev.localmed.nativespike.shared.ui.NativeUiOperation
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withContext
import dev.localmed.nativespike.shared.reader.NativeFilePick
import dev.localmed.nativespike.shared.reader.readDocument

private const val BENCH_QUERY_ACTION = "dev.localmed.nativespike.BENCH_QUERY"
private const val BENCH_LOG_TAG = "MiniMedNativeSpikeBench"

/** One private prototype session survives rotation; production WebView data is never opened. */
class NativeSessionOwner(application: Application) : AndroidViewModel(application) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val io = JVMContentIO(File(application.filesDir, "minimed-native").absolutePath)
    val session = NativeCoreSession(io, { bundledNativeCatalog() }, scope, ::bundledNativeTools)

    init { if (NativeMedicalCore.hasCachedCore(io)) session.retry() }

    override fun onCleared() {
        scope.launch(NonCancellable) {
            try { session.close() } finally { scope.cancel() }
        }
    }
}

class MainActivity : ComponentActivity() {
    private val owner by lazy { ViewModelProvider(this)[NativeSessionOwner::class.java] }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openFileIntent(intent)
    }

    private fun openFileIntent(incoming: Intent?) {
        if (incoming?.action != Intent.ACTION_VIEW) return
        val uri = incoming.data?.takeIf { it.scheme == "content" || it.scheme == "file" } ?: return
        owner.scope.launch {
            val result = try {
                NativeFilePick.Picked(withContext(Dispatchers.IO) { readDocument(this@MainActivity, uri) })
            } catch (cause: CancellationException) { throw cause }
            catch (cause: Exception) { NativeFilePick.Failed("Не удалось открыть файл. Выберите его ещё раз через «Открыть файл».") }
            owner.session.openFile(result)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle=SystemBarStyle.auto(android.graphics.Color.TRANSPARENT,android.graphics.Color.TRANSPARENT),
            navigationBarStyle=SystemBarStyle.auto(android.graphics.Color.TRANSPARENT,android.graphics.Color.TRANSPARENT),
        )
        if(Build.VERSION.SDK_INT>=29) window.isStatusBarContrastEnforced=false
        if (savedInstanceState == null) openFileIntent(intent)
        val startedAtMs = SystemClock.elapsedRealtime()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val core = (owner.session.state.value as? NativeCoreSessionState.Ready)?.core
                if (owner.session.openedFile.value != null || owner.session.panel.value != null || owner.session.toolsState.snapshot.value?.route != null || (core != null && (core.navigation.value.readers.isNotEmpty() || core.navigation.value.catalog != null))) owner.scope.launch { owner.session.back() }
                else moveTaskToBack(true)
            }
        })
        setContent {
            val state by owner.session.state.collectAsState()
            val user by owner.session.userState.snapshot.collectAsState()
            val darkSystem = nativeUserDarkTheme(user?.preferences?.theme ?: NativeThemePreference.System)
            SideEffect {
                val controller = WindowCompat.getInsetsController(window, window.decorView)
                // Both the route desk and reader paper are light in the light theme.
                controller.isAppearanceLightStatusBars = !darkSystem
                controller.isAppearanceLightNavigationBars = !darkSystem
            }
            var benchQuery by remember { mutableStateOf<String?>(null) }
            // Exported query injection and timing hooks exist only in the debug measurement build.
            if (BuildConfig.DEBUG) DisposableEffect(Unit) {
                val receiver = object : BroadcastReceiver() {
                    override fun onReceive(context: Context, intent: Intent) {
                        benchQuery = intent.getStringExtra("query")
                    }
                }
                ContextCompat.registerReceiver(this@MainActivity, receiver, IntentFilter(BENCH_QUERY_ACTION), ContextCompat.RECEIVER_EXPORTED)
                onDispose { unregisterReceiver(receiver) }
            }
            LaunchedEffect(state) {
                if (state is NativeCoreSessionState.Ready) {
                    reportFullyDrawn()
                    if (BuildConfig.DEBUG) {
                        val core = (state as NativeCoreSessionState.Ready).core
                        Log.i("MiniMedNativeSpike", "search-ready tookMs=${SystemClock.elapsedRealtime() - startedAtMs}")
                        core.awaitReady()
                        Log.i("MiniMedNativeSpike", "background-index-ready vocabularyBuildMs=${core.vocabularyBuildMs} indexBuildMs=${core.indexBuildMs}")
                    }
                }
            }
            NativeSessionShell(owner.session) { current ->
                NativeSearchSpikeApp(
                    core = current.core,
                    actionScope = owner.scope,
                    uiErrors = owner.session.uiErrors, session = owner.session,
                    externalQuery = if (BuildConfig.DEBUG) benchQuery else null,
                    onOutcome = if (BuildConfig.DEBUG) { _, outcome, tookMs, stages ->
                        val timings = stages.entries.joinToString(" ") { (name, ms) -> "$name=$ms" }
                        Log.i(BENCH_LOG_TAG, "sqlMs=${outcome?.timing?.sqlOnlyMs} searchFnMs=${outcome?.timing?.totalMs} totalToFrameMs=$tookMs resultGroups=${outcome?.groups?.size ?: 0} stages=[$timings]")
                    } else null,
                )
            }
        }
    }
}
