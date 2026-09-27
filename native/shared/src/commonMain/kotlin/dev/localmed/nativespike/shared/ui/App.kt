package dev.localmed.nativespike.shared.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.search.SearchEngine

/** Which screen is on top: the search list, or a reader open on one document/section. */
private sealed interface Screen {
    data object Search : Screen
    data class Reader(val documentId: String, val documentTitle: String, val sectionAnchor: String?) : Screen
}

/**
 * Root composable for the whole spike app. `database` must already be open()'d by the caller
 * (the Activity does this once and calls back with the elapsed time so it can log/mark
 * readiness before the first frame that shows an enabled search field).
 */
@Composable
fun NativeSearchSpikeApp(database: NativeSearchDatabase) {
    val engine = remember(database) { SearchEngine(database) }
    var screen by remember { mutableStateOf<Screen>(Screen.Search) }

    NativeSpikeTheme {
        when (val current = screen) {
            is Screen.Search -> SearchScreen(
                engine = engine,
                onOpenDocument = { documentId, documentTitle, sectionAnchor ->
                    screen = Screen.Reader(documentId, documentTitle, sectionAnchor)
                },
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
