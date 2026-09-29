package dev.localmed.nativespike.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.search.LookupEngine
import dev.localmed.nativespike.shared.ui.NativeSearchSpikeApp
import dev.localmed.nativespike.shared.ui.NativeSpikeTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Debug measurement backdoor, spike-only: HyperOS blocks `adb shell input` outright on the
 * physical Xiaomi 14 (INJECT_EVENTS denied), and even on a plain emulator `adb shell input text`
 * cannot type Cyrillic (InputShellCommand.sendText throws — no KeyCharacterMap entries for
 * Cyrillic on a stock US layout). The exact WebView-side equivalent (also not real typing) is
 * driving the DOM search input via Chrome DevTools Protocol — see
 * docs/research/native-vs-webview-2026-09-28.md. Trigger from the host:
 *   adb shell am broadcast -a dev.localmed.nativespike.BENCH_QUERY --es query "<text>"
 * `RECEIVER_EXPORTED` only because `adb shell am broadcast` runs as the shell UID, external to
 * the app — acceptable for a local, non-published measurement spike; never appropriate for a
 * shipped app.
 */
private const val BENCH_QUERY_ACTION = "dev.localmed.nativespike.BENCH_QUERY"
private const val BENCH_LOG_TAG = "MiniMedNativeSpikeBench"

/** Local "core opened, first query possible" readiness log, comparable to the web app's
 * `performance.mark('minimed:search-ready')` (apps/app/src/app/use-app-session.ts). Grep logcat
 * for this tag during cold-start measurement. */
private const val LOG_TAG = "MiniMedNativeSpike"

private sealed interface CoreState {
    data object Loading : CoreState
    data class Ready(val database: NativeSearchDatabase, val engine: LookupEngine) : CoreState
    data class Failed(val message: String) : CoreState
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val activityStartedAtMs = SystemClock.elapsedRealtime()

        setContent {
            NativeSpikeTheme {
                var state by remember { mutableStateOf<CoreState>(CoreState.Loading) }
                var benchQuery by remember { mutableStateOf<String?>(null) }

                DisposableEffect(Unit) {
                    val receiver = object : BroadcastReceiver() {
                        override fun onReceive(context: Context, intent: Intent) {
                            benchQuery = intent.getStringExtra("query")
                        }
                    }
                    ContextCompat.registerReceiver(
                        this@MainActivity,
                        receiver,
                        IntentFilter(BENCH_QUERY_ACTION),
                        ContextCompat.RECEIVER_EXPORTED,
                    )
                    onDispose { unregisterReceiver(receiver) }
                }

                LaunchedEffect(Unit) {
                    val dbFile = File(filesDir, "core.db")
                    if (!dbFile.exists()) {
                        state = CoreState.Failed(
                            "core.db не найден в ${dbFile.absolutePath}.\n" +
                                "adb push apps/app/public/content/core.db /data/local/tmp/core.db\n" +
                                "adb shell run-as dev.localmed.nativespike.debug cp " +
                                "/data/local/tmp/core.db /data/data/dev.localmed.nativespike.debug/files/core.db",
                        )
                        return@LaunchedEffect
                    }
                    try {
                        val database = withContext(Dispatchers.IO) {
                            NativeSearchDatabase(dbFile.absolutePath).apply { open() }
                        }
                        val dbOpenAfterMs = SystemClock.elapsedRealtime() - activityStartedAtMs
                        // Stage 4 (docs/CURRENT_STATE.md): building `LookupEngine`'s
                        // `QueryDocumentIndex` (~20k documents) + alias vocabulary is real startup
                        // cost the real WebView pipeline also pays once — logged as its own line so
                        // it's never silently absorbed into "search-ready", per the coordinator's
                        // instruction that a native cold-start number without this would be
                        // dishonestly fast.
                        val engine = withContext(Dispatchers.IO) { LookupEngine(database) }
                        val readyAfterMs = SystemClock.elapsedRealtime() - activityStartedAtMs
                        Log.i(
                            LOG_TAG,
                            "search-ready tookMs=$readyAfterMs dbOpenMs=$dbOpenAfterMs " +
                                "indexBuildMs=${engine.indexBuildMs}",
                        )
                        state = CoreState.Ready(database, engine)
                    } catch (cause: Exception) {
                        Log.e(LOG_TAG, "core.db open failed", cause)
                        state = CoreState.Failed(cause.message ?: "Не удалось открыть core.db")
                    }
                }

                // reportFullyDrawn() gives `adb shell am start -W` a second, later timestamp
                // beyond the first-frame "Displayed" line — the closest native equivalent of the
                // web app's explicit search-ready performance mark.
                LaunchedEffect(state) {
                    if (state is CoreState.Ready || state is CoreState.Failed) {
                        reportFullyDrawn()
                    }
                }

                when (val current = state) {
                    is CoreState.Loading -> LoadingScreen()
                    is CoreState.Ready -> NativeSearchSpikeApp(
                        database = current.database,
                        engine = current.engine,
                        externalQuery = benchQuery,
                        onOutcome = { query, outcome, tookMs ->
                            Log.i(
                                BENCH_LOG_TAG,
                                "query=\"$query\" sqlMs=${outcome?.timing?.sqlOnlyMs} " +
                                    "searchFnMs=${outcome?.timing?.totalMs} totalToFrameMs=$tookMs " +
                                    "resultGroups=${outcome?.groups?.size ?: 0}",
                            )
                        },
                    )
                    is CoreState.Failed -> ErrorScreen(current.message)
                }
            }
        }
    }
}

@Composable
private fun LoadingScreen() {
    Surface(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            CircularProgressIndicator()
            Text("Открываю core.db…", modifier = Modifier.padding(top = 16.dp))
        }
    }
}

@Composable
private fun ErrorScreen(message: String) {
    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
            Text("Ошибка", style = MaterialTheme.typography.titleLarge)
            Text(message, modifier = Modifier.padding(top = 12.dp))
        }
    }
}
