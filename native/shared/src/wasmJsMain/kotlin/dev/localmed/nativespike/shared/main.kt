package dev.localmed.nativespike.shared

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.ComposeViewport
import dev.localmed.nativespike.shared.ui.NativeSpikeTheme
import kotlinx.browser.document

/** Browser compilation surface; no supported SQLite content adapter exists for Wasm yet. */
@OptIn(ExperimentalComposeUiApi::class)
fun main() {
    ComposeViewport(document.body!!) {
        NativeSpikeTheme {
            Surface(Modifier.fillMaxSize()) {
                Text("Браузерная версия нативного интерфейса пока не поддерживает локальную базу источников.", modifier = Modifier.padding(24.dp), style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}
