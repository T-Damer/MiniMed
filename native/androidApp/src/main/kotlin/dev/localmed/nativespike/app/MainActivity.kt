package dev.localmed.nativespike.app

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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.ui.NativeSearchSpikeApp
import dev.localmed.nativespike.shared.ui.NativeSpikeTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** Local "core opened, first query possible" readiness log, comparable to the web app's
 * `performance.mark('minimed:search-ready')` (apps/app/src/app/use-app-session.ts). Grep logcat
 * for this tag during cold-start measurement. */
private const val LOG_TAG = "MiniMedNativeSpike"

private sealed interface CoreState {
    data object Loading : CoreState
    data class Ready(val database: NativeSearchDatabase) : CoreState
    data class Failed(val message: String) : CoreState
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val activityStartedAtMs = SystemClock.elapsedRealtime()

        setContent {
            NativeSpikeTheme {
                var state by remember { mutableStateOf<CoreState>(CoreState.Loading) }

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
                        val readyAfterMs = SystemClock.elapsedRealtime() - activityStartedAtMs
                        Log.i(LOG_TAG, "search-ready tookMs=$readyAfterMs")
                        state = CoreState.Ready(database)
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
                    is CoreState.Ready -> NativeSearchSpikeApp(current.database)
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
