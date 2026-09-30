@file:OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)

package dev.localmed.nativespike.shared.user

import dev.localmed.nativespike.shared.core.NativeContentIO
import dev.localmed.nativespike.shared.model.NativeSearchSelection
import dev.localmed.nativespike.shared.model.validateSearchSelection
import kotlinx.serialization.EncodeDefault
import dev.localmed.nativespike.shared.core.NATIVE_SEARCH_QUERY_MAX_LENGTH
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.Required
import kotlinx.serialization.SerializationException
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.time.Instant
import kotlin.time.Clock
import kotlin.time.ExperimentalTime

const val NATIVE_HISTORY_LIMIT = 40
val NATIVE_TEXT_SCALE_LEVELS = listOf(90, 100, 110, 125, 140)

@Serializable enum class NativeThemePreference { System, Light, Dark }
@Serializable enum class NativeHistoryScope { Core }
@Serializable enum class NativeHistoryAnalysisMode { Lookup, Clinical }
@Serializable enum class NativeHistoryRetrievalMode { Lexical }

@Serializable data class NativeUserPreferences(
    @Required val theme: NativeThemePreference = NativeThemePreference.System,
    @Required val textScalePercent: Int = 100,
)

@Serializable data class NativeHistoryEntry(
    val id: String, val query: String, val createdAt: String, val resultCount: Int,
    val scope: NativeHistoryScope,
    val analysisMode: NativeHistoryAnalysisMode,
    val modeUsed: NativeHistoryRetrievalMode,
    @EncodeDefault(EncodeDefault.Mode.NEVER) val selection: NativeSearchSelection = NativeSearchSelection(),
)

@Serializable data class NativeUserSnapshot(
    val schemaVersion: Int,
    @Required val preferences: NativeUserPreferences = NativeUserPreferences(),
    @Required val history: List<NativeHistoryEntry> = emptyList(),
)

class NativeUserStateFormatException : IllegalArgumentException("Unsupported or damaged private user-state format")

/** Private prototype user data, independent of downloaded medical content and its navigation. */
class NativeUserState(private val io: NativeContentIO) {
    private val mutex = Mutex()
    private val json = Json { encodeDefaults = true }
    private val mutableSnapshot = MutableStateFlow<NativeUserSnapshot?>(null)
    val snapshot: StateFlow<NativeUserSnapshot?> = mutableSnapshot.asStateFlow()
    private val path = "native-user-state.json"

    suspend fun load() = mutex.withLock {
        if (mutableSnapshot.value != null) return@withLock
        val loaded = if (io.exists(path)) {
            val raw = io.readText(path)
            try { json.decodeFromString<NativeUserSnapshot>(raw).also { validate(it) } }
            catch (cause: SerializationException) { throw NativeUserStateFormatException() }
            catch (cause: IllegalArgumentException) { throw NativeUserStateFormatException() }
        } else NativeUserSnapshot(1)
        mutableSnapshot.value = loaded
    }

    suspend fun setTheme(theme: NativeThemePreference) = mutate { it.copy(preferences = it.preferences.copy(theme = theme)) }
    suspend fun setTextScalePercent(percent: Int) = mutate { it.copy(preferences = it.preferences.copy(textScalePercent = percent)) }

    suspend fun recordSearch(query: String, resultCount: Int, mode: NativeHistoryAnalysisMode) = recordCompletedSearch(nativeCompletedSearch(query, resultCount, mode))

    @OptIn(ExperimentalTime::class)
    suspend fun recordCompletedSearch(entry: NativeHistoryEntry) = mutate { current ->
        val sameQuery = current.history.find { it.query == entry.query && it.scope == entry.scope && it.analysisMode == entry.analysisMode && it.selection == entry.selection }
        if (sameQuery != null && Instant.parse(sameQuery.createdAt) > Instant.parse(entry.createdAt)) current
        else current.copy(history = (listOf(entry) + current.history.filter {
                it.query != entry.query || it.scope != entry.scope || it.analysisMode != entry.analysisMode || it.selection != entry.selection
            }).sortedByDescending { Instant.parse(it.createdAt) }.take(NATIVE_HISTORY_LIMIT))
    }

    suspend fun deleteHistory(id: String) = mutate { it.copy(history = it.history.filterNot { entry -> entry.id == id }) }
    suspend fun clearHistory() = mutate { it.copy(history = emptyList()) }
    suspend fun awaitWrites() = mutex.withLock { }

    private suspend fun mutate(change: (NativeUserSnapshot) -> NativeUserSnapshot) = mutex.withLock {
        val current = requireNotNull(mutableSnapshot.value) { "User state is not loaded" }
        val next = change(current)
        validate(next)
        if (next == current) return@withLock
        io.writeTextAtomic(path, json.encodeToString(next))
        mutableSnapshot.value = next
    }

    @OptIn(ExperimentalTime::class)
    private fun validate(value: NativeUserSnapshot) {
        require(value.schemaVersion == 1) { "Unsupported private user-state format" }
        require(value.preferences.textScalePercent in NATIVE_TEXT_SCALE_LEVELS)
        require(value.history.size <= NATIVE_HISTORY_LIMIT)
        require(value.history.map { it.id }.distinct().size == value.history.size)
        value.history.forEach {
            require(it.id.isNotBlank() && it.createdAt.isNotBlank() && it.resultCount >= 0)
            Instant.parse(it.createdAt)
            validateSearchSelection(it.selection)
            require(it.query.isNotBlank() && it.query.length <= NATIVE_SEARCH_QUERY_MAX_LENGTH && '\u0000' !in it.query)
        }
    }
}

@OptIn(ExperimentalTime::class)
fun nativeCompletedSearch(query: String, resultCount: Int, mode: NativeHistoryAnalysisMode, selection: NativeSearchSelection = NativeSearchSelection()): NativeHistoryEntry {
    val trimmed = query.trim()
    require(trimmed.isNotEmpty() && trimmed.length <= NATIVE_SEARCH_QUERY_MAX_LENGTH && '\u0000' !in trimmed && resultCount >= 0)
    val instant = Clock.System.now().toString()
    return NativeHistoryEntry("$instant-${kotlin.random.Random.nextLong().toString(16)}", trimmed, instant, resultCount,
        NativeHistoryScope.Core, mode, NativeHistoryRetrievalMode.Lexical,selection)
}
