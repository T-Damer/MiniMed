package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.localmed.nativespike.shared.core.NativeSearchSnapshot
import dev.localmed.nativespike.shared.model.SearchOutcome
import dev.localmed.nativespike.shared.model.NativeSearchMode

/** Kept by the app root while readers are open; durable results are recomputed from this query. */
class NativeSearchUiState(snapshot: NativeSearchSnapshot) {
    var query by mutableStateOf(snapshot.query)
        private set
    var mode by mutableStateOf(snapshot.mode)
        private set
    var inputError by mutableStateOf<String?>(null)
        private set
    var outcome by mutableStateOf<SearchOutcome?>(null)
    var loading by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var attempt by mutableStateOf(0)
    var completedQuery: String? = null
    var completedMode: NativeSearchMode? = null
    var positionQuery: String = snapshot.query
    var positionMode: NativeSearchMode = snapshot.mode
    val listState = LazyListState(snapshot.firstVisibleItemIndex.coerceAtLeast(0), snapshot.firstVisibleItemOffset.coerceAtLeast(0))

    fun updateQuery(value: String) {
        inputError = nativeSearchInputError(value)
        if (inputError == null && value != query) {
            query = value
            outcome = null
            completedQuery = null
            completedMode = null
            error = null
        }
    }

    fun updateMode(value: NativeSearchMode) {
        if (mode == value) return
        mode = value
        outcome = null
        completedQuery = null
        completedMode = null
        error = null
    }

    fun acceptsLookupIdentities(requestQuery: String, requestMode: NativeSearchMode): Boolean =
        requestMode == NativeSearchMode.LOOKUP && mode == requestMode && query == requestQuery

    fun snapshot(): NativeSearchSnapshot {
        val resetPosition = positionQuery != query || positionMode != mode
        return NativeSearchSnapshot(query, if (resetPosition) 0 else listState.firstVisibleItemIndex,
            if (resetPosition) 0 else listState.firstVisibleItemScrollOffset, mode)
    }
}
