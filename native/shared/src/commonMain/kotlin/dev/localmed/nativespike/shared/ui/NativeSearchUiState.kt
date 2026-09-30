package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.localmed.nativespike.shared.core.NativeSearchSnapshot
import dev.localmed.nativespike.shared.model.SearchOutcome

/** Kept by the app root while readers are open; durable results are recomputed from this query. */
class NativeSearchUiState(snapshot: NativeSearchSnapshot) {
    var query by mutableStateOf(snapshot.query)
        private set
    var inputError by mutableStateOf<String?>(null)
        private set
    var outcome by mutableStateOf<SearchOutcome?>(null)
    var loading by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var attempt by mutableStateOf(0)
    var completedQuery: String? = null
    var positionQuery: String = snapshot.query
    val listState = LazyListState(snapshot.firstVisibleItemIndex.coerceAtLeast(0), snapshot.firstVisibleItemOffset.coerceAtLeast(0))

    fun updateQuery(value: String) {
        inputError = nativeSearchInputError(value)
        if (inputError == null) query = value
    }

    fun snapshot() = NativeSearchSnapshot(query, listState.firstVisibleItemIndex, listState.firstVisibleItemScrollOffset)
}
