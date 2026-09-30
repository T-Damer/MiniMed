package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.content.JVMContentIO
import java.io.File
import dev.localmed.nativespike.shared.user.NativeItemKind
import dev.localmed.nativespike.shared.user.NativeItemRef
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch

class NativeSessionNavigationFlushTest {
    @Test fun searchTabKeepsTheCoveredPanelWhenCurrentPositionCannotBeSaved() = runBlocking {
        val repository = File(requireNotNull(System.getProperty("TEST_RESOURCE_DIR"))).parentFile.parentFile.parentFile.parentFile.parentFile
        val profile = File(repository, "playwright/native-session-search-tab-fixture")
        val session = NativeCoreSession(JVMContentIO(profile.absolutePath), { error("Not opened") }, this)
        try {
            session.openPanel(NativeUserPanel.Settings)
            var canSave = false
            session.registerNavigationFlush { canSave }
            assertFalse(session.showSearch())
            assertEquals(NativeUserPanel.Settings, session.panel.value)
            canSave = true
            assertTrue(session.showSearch())
            assertEquals(null, session.panel.value)
        } finally {
            session.close()
            if (profile.exists()) check(profile.deleteRecursively())
        }
    }

    @Test fun collectionOpenPreservesUnavailableItemsAndSerializesBack() = runBlocking {
        val repository = File(requireNotNull(System.getProperty("TEST_RESOURCE_DIR"))).parentFile.parentFile.parentFile.parentFile.parentFile
        val profile = File(repository, "playwright/native-session-collections-fixture")
        val session = NativeCoreSession(JVMContentIO(profile.absolutePath), { error("Not opened") }, this)
        val item = NativeItemRef(NativeItemKind.Document, "saved-source", addedAt = "2026-09-30T00:00:00Z", title = "Saved source")
        try {
            session.collectionsState.load()
            session.collectionsState.toggleFavorite(item, "2026-09-30T00:00:00Z")
            session.openCollections()
            val unavailable = session.registerCollectionItemHandler { "Exact edition is unavailable" }
            assertFalse(session.openCollectionItem(item))
            assertEquals(NativeUserPanel.Collections, session.panel.value)
            assertEquals("Exact edition is unavailable", session.uiErrors.messages.value[NativeUiOperation.Collections])
            assertEquals(listOf(item), session.collectionsState.snapshot.value?.favorites)
            unavailable()
            val entered = CompletableDeferred<Unit>()
            val finish = CompletableDeferred<Unit>()
            session.registerCollectionItemHandler { entered.complete(Unit); finish.await(); null }
            val opening = launch { assertTrue(session.openCollectionItem(item)) }
            entered.await()
            assertFalse(session.back())
            assertFalse(session.openCollectionItem(item))
            finish.complete(Unit)
            opening.join()
            assertEquals(null, session.panel.value)
            assertEquals(listOf(item), session.collectionsState.snapshot.value?.favorites)
            assertTrue(session.uiErrors.messages.value.isEmpty())
        } finally {
            session.close()
            check(profile.deleteRecursively())
        }
    }

    @Test fun collectionOpenRequiresSavedPositionAndCurrentHandler() = runBlocking {
        val repository = File(requireNotNull(System.getProperty("TEST_RESOURCE_DIR"))).parentFile.parentFile.parentFile.parentFile.parentFile
        val profile = File(repository, "playwright/native-session-collections-flush-fixture")
        val session = NativeCoreSession(JVMContentIO(profile.absolutePath), { error("Not opened") }, this)
        val item = NativeItemRef(NativeItemKind.Document, "saved-source")
        try {
            session.openCollections()
            var opened = false
            val dispose = session.registerCollectionItemHandler { opened = true; null }
            session.registerNavigationFlush { false }
            assertFalse(session.openCollectionItem(item))
            assertFalse(opened)
            assertEquals(NativeUserPanel.Collections, session.panel.value)
            session.registerNavigationFlush { dispose(); true }
            assertFalse(session.openCollectionItem(item))
            assertFalse(opened)
            assertEquals(NativeUserPanel.Collections, session.panel.value)
        } finally {
            session.close()
            check(profile.deleteRecursively())
        }
    }

    @Test fun staleDisposalCannotRemoveCurrentViewportAndWriteFailureRemainsVisible() = runBlocking {
        val repository = File(requireNotNull(System.getProperty("TEST_RESOURCE_DIR"))).parentFile.parentFile.parentFile.parentFile.parentFile
        val profile = File(repository, "playwright/native-session-back-fixture")
        val session = NativeCoreSession(JVMContentIO(profile.absolutePath), { error("Not opened") }, this)
        val disposeOld = session.registerNavigationFlush { error("Stale route must not run") }
        var position = 4096
        var writeFails = true
        val saved = mutableListOf<Int>()
        val disposeCurrent = session.registerNavigationFlush {
            session.uiErrors.execute(NativeUiOperation.ReaderPosition, "Position not saved") {
                if (writeFails) error("OS write failed")
                saved += position
            }
        }
        disposeOld()
        assertFalse(session.flushUi())
        assertEquals("Position not saved", session.uiErrors.messages.value[NativeUiOperation.ReaderPosition])
        position = 8192
        writeFails = false
        assertTrue(session.flushUi())
        assertEquals(listOf(8192), saved)
        assertTrue(session.uiErrors.messages.value.isEmpty())
        disposeCurrent()
        assertTrue(session.flushUi())
        session.close()
        check(profile.delete())
    }
}
