package dev.localmed.nativespike.shared.ui

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

enum class NativeUiOperation { Navigation, SearchPosition, ReaderPosition, CatalogPosition, UserState, UserPreferences, UserHistory, CollectionsState, Collections, ToolsState }

/** Host-retained UI failures; retries always receive the current action or current snapshot. */
class NativeUiErrors {
    private val mutableMessages = MutableStateFlow<Map<NativeUiOperation, String>>(emptyMap())
    val messages: StateFlow<Map<NativeUiOperation, String>> = mutableMessages.asStateFlow()
    fun report(operation: NativeUiOperation, message: String) { mutableMessages.update { it + (operation to message) } }
    fun clear(operation: NativeUiOperation) { mutableMessages.update { it - operation } }
    suspend fun execute(operation: NativeUiOperation, message: String, action: suspend () -> Unit): Boolean = try {
        action()
        mutableMessages.update { it - operation }
        true
    } catch (cause: CancellationException) { throw cause }
    catch (cause: Exception) { report(operation, message); false }
}
