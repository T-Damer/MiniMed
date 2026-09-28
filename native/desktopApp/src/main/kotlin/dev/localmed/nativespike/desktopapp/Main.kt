package dev.localmed.nativespike.desktopapp

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
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.WindowPosition
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.ui.NativeSearchSpikeApp
import dev.localmed.nativespike.shared.ui.NativeSpikeTheme
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Same repo-relative fallback the README/ADR describe: `MINIMED_CORE_DB` env var, else the repo's
 * own released core.db two directories up from this module (`native/desktopApp` -> repo root). */
private fun resolveCoreDbPath(): File {
    val override = System.getenv("MINIMED_CORE_DB")
    if (override != null) return File(override)
    return File("../../apps/app/public/content/core.db").absoluteFile
}

private sealed interface CoreState {
    data object Loading : CoreState
    data class Ready(val database: NativeSearchDatabase) : CoreState
    data class Failed(val message: String) : CoreState
}

fun main() = application {
    val windowState = rememberWindowState(size = DpSize(480.dp, 900.dp), position = WindowPosition(Alignment.Center))
    Window(onCloseRequest = ::exitApplication, title = "LocalMed Native (spike) — Desktop", state = windowState) {
        NativeSpikeTheme {
            var state by remember { mutableStateOf<CoreState>(CoreState.Loading) }
            LaunchedEffect(Unit) {
                val dbFile = resolveCoreDbPath()
                if (!dbFile.exists()) {
                    state = CoreState.Failed(
                        "core.db not found at ${dbFile.path}.\n" +
                            "Set MINIMED_CORE_DB=/abs/path/to/core.db or run from native/desktopApp " +
                            "with the repo checked out at ../../ (two levels up).",
                    )
                    return@LaunchedEffect
                }
                try {
                    val database = withContext(Dispatchers.IO) {
                        NativeSearchDatabase(dbFile.absolutePath).apply { open() }
                    }
                    state = CoreState.Ready(database)
                } catch (cause: Exception) {
                    state = CoreState.Failed(cause.message ?: "Failed to open core.db")
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

@Composable
private fun LoadingScreen() {
    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            CircularProgressIndicator()
            Text("Opening core.db…", modifier = Modifier.padding(top = 16.dp))
        }
    }
}

@Composable
private fun ErrorScreen(message: String) {
    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(24.dp)) {
            Text("Error", style = MaterialTheme.typography.titleLarge)
            Text(message, modifier = Modifier.padding(top = 12.dp))
        }
    }
}
