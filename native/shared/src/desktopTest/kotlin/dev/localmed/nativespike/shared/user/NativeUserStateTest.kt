package dev.localmed.nativespike.shared.user

import dev.localmed.nativespike.shared.content.JVMContentIO
import dev.localmed.nativespike.shared.core.NativeContentIO
import dev.localmed.nativespike.shared.model.NativeSearchMode
import dev.localmed.nativespike.shared.ui.NativeCoreSession
import dev.localmed.nativespike.shared.ui.NativeUiOperation
import dev.localmed.nativespike.shared.ui.NativeUserPanel
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.yield

class NativeUserStateTest {
    private fun profile(): File {
        val repository = File(requireNotNull(System.getProperty("TEST_RESOURCE_DIR"))).parentFile.parentFile.parentFile.parentFile.parentFile
        return File(repository, "playwright").resolve("native-user-${System.nanoTime()}").apply { mkdirs() }
    }

    @Test fun boundedCompletedHistoryDeduplicatesAndRestoresActualModesAndSettings() = runBlocking {
        val profile = profile()
        try {
            val io = JVMContentIO(profile.absolutePath)
            val state = NativeUserState(io)
            state.load()
            state.setTheme(NativeThemePreference.Dark)
            state.setTextScalePercent(125)
            repeat(42) { state.recordSearch("МКБ $it", it, NativeHistoryAnalysisMode.Lookup) }
            state.recordSearch("  МКБ 40  ", 8, NativeHistoryAnalysisMode.Lookup)
            val history = requireNotNull(state.snapshot.value).history
            assertEquals(40, history.size)
            assertEquals("МКБ 40", history.first().query)
            assertEquals(1, history.count { it.query == "МКБ 40" })
            assertEquals(8, history.first().resultCount)
            assertEquals(NativeHistoryScope.Core, history.first().scope)
            assertEquals(NativeHistoryAnalysisMode.Lookup, history.first().analysisMode)
            assertEquals(NativeHistoryRetrievalMode.Lexical, history.first().modeUsed)
            val restored = NativeUserState(io).also { it.load() }
            assertEquals(state.snapshot.value, restored.snapshot.value)
            restored.deleteHistory(history.first().id)
            assertEquals(39, restored.snapshot.value?.history?.size)
            restored.clearHistory()
            assertTrue(requireNotNull(NativeUserState(io).also { it.load() }.snapshot.value).history.isEmpty())
            assertEquals(NativeUserPreferences(NativeThemePreference.Dark, 125), restored.snapshot.value?.preferences)
        } finally { check(profile.deleteRecursively()) }
    }

    @Test fun failedAtomicWritesNeverPublishSettingsDeleteOrClear() = runBlocking {
        val profile = profile()
        try {
            val real = JVMContentIO(profile.absolutePath)
            var fail = false
            val io = object : NativeContentIO by real {
                override suspend fun writeTextAtomic(path: String, text: String) {
                    if (fail) error("Simulated OS write failure")
                    real.writeTextAtomic(path, text)
                }
            }
            val state = NativeUserState(io).also { it.load() }
            state.recordSearch("менингит", 4, NativeHistoryAnalysisMode.Lookup)
            val saved = state.snapshot.value
            val file = File(profile, "native-user-state.json").readText()
            fail = true
            assertFailsWith<IllegalStateException> { state.setTheme(NativeThemePreference.Light) }
            assertFailsWith<IllegalStateException> { state.clearHistory() }
            assertFailsWith<IllegalStateException> { state.deleteHistory(requireNotNull(saved).history.first().id) }
            assertEquals(saved, state.snapshot.value)
            assertEquals(file, File(profile, "native-user-state.json").readText())
            fail = false
            state.clearHistory()
            assertTrue(requireNotNull(state.snapshot.value).history.isEmpty())
        } finally { check(profile.deleteRecursively()) }
    }

    @Test fun unknownOrCorruptUserFormatIsKeptAndExplicitlyRejected() = runBlocking {
        val profile = profile()
        try {
            val io = JVMContentIO(profile.absolutePath)
            val file = File(profile, "native-user-state.json")
            for (raw in listOf("{\"schemaVersion\":99}", "not-json", "{}")) {
                file.writeText(raw)
                val state = NativeUserState(io)
                assertFailsWith<Exception> { state.load() }
                assertNull(state.snapshot.value)
                assertEquals(raw, file.readText())
            }
        } finally { check(profile.deleteRecursively()) }
    }

    @Test fun panelsWorkBeforeCoreAndReplayFlushesCurrentDraftOrKeepsPanelOnFailure() = runBlocking {
        val profile = profile()
        try {
            val session = NativeCoreSession(JVMContentIO(profile.absolutePath), { error("Core must not open") }, this)
            assertTrue(session.loadUserState())
            session.openPanel(NativeUserPanel.Settings)
            assertEquals(NativeUserPanel.Settings, session.panel.value)
            assertTrue(session.back())
            var fail = false
            var draft = "current draft"
            var flushed: String? = null
            session.registerNavigationFlush {
                session.uiErrors.execute(NativeUiOperation.SearchPosition, "Draft not saved") {
                    if (fail) error("OS error")
                    flushed = draft
                }
            }
            var replayed: String? = null
            session.registerReplayHandler { replayed = it.query }
            session.openPanel(NativeUserPanel.History)
            draft = "latest draft"
            fail = true
            assertFalse(session.replay(nativeCompletedSearch("saved query", 1, NativeHistoryAnalysisMode.Lookup)))
            assertNull(replayed)
            assertEquals(NativeUserPanel.History, session.panel.value)
            assertNotNull(session.uiErrors.messages.value[NativeUiOperation.SearchPosition])
            fail = false
            assertTrue(session.replay(nativeCompletedSearch("saved query", 1, NativeHistoryAnalysisMode.Lookup)))
            assertEquals("latest draft", flushed)
            assertEquals("saved query", replayed)
            assertNull(session.panel.value)
            session.close()
        } finally { check(profile.deleteRecursively()) }
    }

    @Test fun failedCompletedSearchSurvivesNextSuccessfulSearchAndRetriesInCompletionOrder() = runBlocking {
        val profile = profile()
        try {
            val real = JVMContentIO(profile.absolutePath)
            var fail = true
            val io = object : NativeContentIO by real {
                override suspend fun writeTextAtomic(path: String, text: String) {
                    if (fail) error("OS write failure")
                    real.writeTextAtomic(path, text)
                }
            }
            val session = NativeCoreSession(io, { error("No core") }, this)
            session.recordSearch("первый завершённый поиск", 2, NativeSearchMode.LOOKUP)
            assertTrue(session.historyPending.value)
            assertTrue(requireNotNull(session.userState.snapshot.value).history.isEmpty())
            fail = false
            session.recordSearch("второй завершённый поиск", 5, NativeSearchMode.LOOKUP)
            assertTrue(session.historyPending.value)
            assertEquals(listOf("второй завершённый поиск"), session.userState.snapshot.value?.history?.map { it.query })
            session.retryHistory()
            assertFalse(session.historyPending.value)
            assertEquals(listOf("второй завершённый поиск", "первый завершённый поиск"), session.userState.snapshot.value?.history?.map { it.query })
            val restored = NativeUserState(io).also { it.load() }
            assertEquals(session.userState.snapshot.value, restored.snapshot.value)
            session.close()
        } finally { check(profile.deleteRecursively()) }
    }
    @Test fun olderRetryCannotReplaceNewerSameQueryIdentityDateOrCount() = runBlocking {
        val profile = profile()
        try {
            val state = NativeUserState(JVMContentIO(profile.absolutePath)).also { it.load() }
            val original = nativeCompletedSearch("одинаковый запрос", 1, NativeHistoryAnalysisMode.Lookup).copy(id = "old", createdAt = "2026-09-30T01:00:00Z")
            val newer = original.copy(id = "new", createdAt = "2026-09-30T01:00:01Z", resultCount = 9)
            state.recordCompletedSearch(newer)
            val persisted = File(profile, "native-user-state.json").readText()
            state.recordCompletedSearch(original)
            assertEquals(listOf(newer), state.snapshot.value?.history)
            assertEquals(persisted, File(profile, "native-user-state.json").readText())
        } finally { check(profile.deleteRecursively()) }
    }

    @Test fun overlappingPreferenceActionsMergeLatestAtomicStateRatherThanCapturedScreenSnapshot() = runBlocking {
        val profile = profile()
        try {
            val real = JVMContentIO(profile.absolutePath)
            val firstWrite = CompletableDeferred<Unit>()
            val release = CompletableDeferred<Unit>()
            var writes = 0
            val io = object : NativeContentIO by real {
                override suspend fun writeTextAtomic(path: String, text: String) {
                    if (++writes == 1) { firstWrite.complete(Unit); release.await() }
                    real.writeTextAtomic(path, text)
                }
            }
            val state = NativeUserState(io).also { it.load() }
            val themeAction = launch { state.setTheme(NativeThemePreference.Light) }
            firstWrite.await()
            val reopenedSettingsScaleAction = launch { state.setTextScalePercent(125) }
            yield()
            release.complete(Unit)
            themeAction.join()
            reopenedSettingsScaleAction.join()
            assertEquals(NativeUserPreferences(NativeThemePreference.Light, 125), state.snapshot.value?.preferences)
            val restored = NativeUserState(io).also { it.load() }
            assertEquals(state.snapshot.value, restored.snapshot.value)
        } finally { check(profile.deleteRecursively()) }
    }

    @Test fun lookupAndClinicalHistoryStayDistinctAndReplayTheirActualModeAfterRestart() = runBlocking {
        val profile = profile()
        try {
            val real = JVMContentIO(profile.absolutePath)
            var fail = false
            val io = object : NativeContentIO by real {
                override suspend fun writeTextAtomic(path: String, text: String) {
                    if (fail) error("OS failure")
                    real.writeTextAtomic(path, text)
                }
            }
            val session = NativeCoreSession(io, { error("No core opened") }, this)
            session.recordSearch("одинаковый запрос", 2, NativeSearchMode.LOOKUP)
            fail = true
            session.recordSearch("одинаковый запрос", 6, NativeSearchMode.CLINICAL)
            fail = false
            session.recordSearch("одинаковый запрос", 3, NativeSearchMode.LOOKUP)
            assertTrue(session.historyPending.value)
            session.retryHistory()
            val restored = NativeUserState(io).also { it.load() }
            val history = requireNotNull(restored.snapshot.value).history
            assertEquals(2, history.size)
            assertEquals(listOf(NativeHistoryAnalysisMode.Lookup, NativeHistoryAnalysisMode.Clinical), history.map { it.analysisMode })
            assertEquals(listOf(3, 6), history.map { it.resultCount })
            var replayed: NativeHistoryEntry? = null
            session.registerReplayHandler { replayed = it }
            session.openPanel(NativeUserPanel.History)
            assertTrue(session.replay(history.last()))
            assertEquals(history.last(), replayed)
            session.close()
        } finally { check(profile.deleteRecursively()) }
    }

}
