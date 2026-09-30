package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.localmed.nativespike.shared.core.NativeSearchSnapshot
import dev.localmed.nativespike.shared.model.SearchOutcome
import dev.localmed.nativespike.shared.model.NativeSearchMode
import dev.localmed.nativespike.shared.model.NativeSearchSelection

/** Kept by the app root while readers are open; durable results are recomputed from this query. */
class NativeSearchUiState(snapshot: NativeSearchSnapshot) {
    private var edited = false
    var query by mutableStateOf(snapshot.query)
        private set
    var mode by mutableStateOf(snapshot.mode)
        private set
    var selection by mutableStateOf(snapshot.selection)
        private set
    var inputError by mutableStateOf<String?>(null)
        private set
    var outcome by mutableStateOf<SearchOutcome?>(null)
    var loading by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var attempt by mutableStateOf(0)
    var queuedQuery by mutableStateOf<String?>(null)
        private set
    var completedSelection: NativeSearchSelection? = null
    var positionSelection: NativeSearchSelection = snapshot.selection
    var completedQuery: String? = null
    var completedMode: NativeSearchMode? = null
    var positionQuery: String = snapshot.query
    var positionMode: NativeSearchMode = snapshot.mode
    val listState = LazyListState(snapshot.firstVisibleItemIndex.coerceAtLeast(0), snapshot.firstVisibleItemOffset.coerceAtLeast(0))

    fun updateQuery(value: String) {
        inputError = nativeSearchInputError(value)
        if (inputError == null && value != query) {
            edited = true
            query = value
            queuedQuery = null
            outcome = null
            completedQuery = null
            completedMode = null
            completedSelection = null
            error = null
        }
    }

    fun submit(waitingForCore: Boolean) {
        if (query.isBlank() || inputError != null) return
        queuedQuery = if (waitingForCore) query else null
        attempt += 1
    }

    fun completeQueuedQuery(requestQuery: String) {
        if (queuedQuery == requestQuery) queuedQuery = null
    }

    fun restoreWhenUntouched(saved: NativeSearchSnapshot): NativeSearchUiState =
        if (edited || attempt > 0) this else NativeSearchUiState(saved)

    fun updateMode(value: NativeSearchMode) {
        if (mode == value) return
        edited = true
        mode = value
        outcome = null
        completedQuery = null
        completedMode = null
        completedSelection = null
        error = null
    }

    fun updateSelection(value: NativeSearchSelection) {
        if(selection==value) return
        edited = true
        selection=value;outcome=null;completedQuery=null;completedMode=null;completedSelection=null;error=null
    }
    fun acceptsRequest(requestQuery: String,requestMode: NativeSearchMode,requestSelection: NativeSearchSelection): Boolean =
        query==requestQuery && mode==requestMode && selection==requestSelection
    fun acceptsLookupIdentities(requestQuery: String, requestMode: NativeSearchMode,requestSelection: NativeSearchSelection = NativeSearchSelection()): Boolean =
        requestMode == NativeSearchMode.LOOKUP && acceptsRequest(requestQuery,requestMode,requestSelection)

    fun snapshot(): NativeSearchSnapshot {
        val resetPosition = positionQuery != query || positionMode != mode || positionSelection != selection
        return NativeSearchSnapshot(query, if (resetPosition) 0 else listState.firstVisibleItemIndex,
            if (resetPosition) 0 else listState.firstVisibleItemScrollOffset, mode,selection)
    }
}
