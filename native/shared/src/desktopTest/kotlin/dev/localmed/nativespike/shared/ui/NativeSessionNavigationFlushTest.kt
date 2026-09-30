package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.content.JVMContentIO
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking

class NativeSessionNavigationFlushTest {
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
