package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.model.SearchOutcome
import dev.localmed.nativespike.shared.search.LookupEngine

/** Which screen is on top: the search list, or a reader open on one document/section. */
private sealed interface Screen {
    data object Search : Screen
    data class Reader(val documentId: String, val documentTitle: String, val sectionAnchor: String?) : Screen
}

/**
 * Root composable for the whole spike app. `database` must already be open()'d by the caller
 * (the Activity does this once and calls back with the elapsed time so it can log/mark
 * readiness before the first frame that shows an enabled search field).
 *
 * @param demoNotice When non-null, rendered as a persistent, impossible-to-miss banner above
 *   everything else. Used only by the wasmJs (web) entry point, whose `NativeSearchDatabase`
 *   actual is a fixed in-memory stub, not real core.db access — see that file's header for why.
 *   Every other platform passes null.
 * @param engine Stage 4 (docs/CURRENT_STATE.md): the full ported pipeline (`LookupEngine`),
 *   replacing the old single-branch `SearchEngine`. `MainActivity` builds this itself (on a
 *   background thread, before declaring the app "ready") so it can time and log index construction
 *   separately from first-frame — see `LookupEngine`'s doc. Other callers (desktop/wasmJs `main.kt`,
 *   not part of this migration's Android emulator measurement pass) may omit it; one is built
 *   lazily on first composition in that case, on whatever thread composition happens to run on.
 */
@Composable
fun NativeSearchSpikeApp(
    database: NativeSearchDatabase,
    demoNotice: String? = null,
    engine: LookupEngine? = null,
    // Passed straight through to SearchScreen — see its doc comment. Only the androidApp debug
    // bench harness ever sets these.
    externalQuery: String? = null,
    onOutcome: ((query: String, outcome: SearchOutcome?, tookMs: Double, stages: Map<String, Double>) -> Unit)? = null,
) {
    val resolvedEngine = engine ?: remember(database) { LookupEngine(database) }
    var screen by remember { mutableStateOf<Screen>(Screen.Search) }

    NativeSpikeTheme {
        Column {
            if (demoNotice != null) {
                Text(
                    demoNotice,
                    style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.errorContainer)
                        .padding(8.dp),
                )
            }
            when (val current = screen) {
                is Screen.Search -> SearchScreen(
                    engine = resolvedEngine,
                    onOpenDocument = { documentId, documentTitle, sectionAnchor ->
                        screen = Screen.Reader(documentId, documentTitle, sectionAnchor)
                    },
                    externalQuery = externalQuery,
                    onOutcome = onOutcome,
                )
                is Screen.Reader -> ReaderScreen(
                    database = database,
                    documentId = current.documentId,
                    documentTitle = current.documentTitle,
                    initialSectionAnchor = current.sectionAnchor,
                    onBack = { screen = Screen.Search },
                )
            }
        }
    }
}
