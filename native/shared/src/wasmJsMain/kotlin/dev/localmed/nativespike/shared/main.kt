package dev.localmed.nativespike.shared

import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.window.ComposeViewport
import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.ui.NativeSearchSpikeApp
import kotlinx.browser.document

/** Kotlin/Wasm browser entry point. Proves the commonMain Compose UI renders via Compose
 * Multiplatform for Web — see NativeSearchDatabase.wasmJs.kt for why this is a data STUB, not a
 * real core.db-backed build. */
@OptIn(ExperimentalComposeUiApi::class)
fun main() {
    val database = NativeSearchDatabase("") // path is ignored by the wasmJs stub actual
    database.open()
    ComposeViewport(document.body!!) {
        NativeSearchSpikeApp(
            database = database,
            demoNotice = "ВЕБ-ДЕМО: без настоящей базы core.db (нет SQLite-движка в браузере, см. ADR-0021). Показаны фиксированные тестовые данные.",
        )
    }
}
