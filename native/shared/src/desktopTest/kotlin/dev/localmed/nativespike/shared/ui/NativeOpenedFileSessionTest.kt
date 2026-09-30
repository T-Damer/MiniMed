package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.content.JVMContentIO
import dev.localmed.nativespike.shared.reader.NativeFilePick
import dev.localmed.nativespike.shared.reader.NativeOpenedFile
import dev.localmed.nativespike.shared.reader.NativeReaderContent
import dev.localmed.nativespike.shared.reader.plainText
import java.io.File
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class NativeOpenedFileSessionTest {
    @Test fun fileReaderWorksWithoutCoreAndReturnsToItsOriginWithoutDiscardingTheDraft() = runBlocking {
        val repository = File(requireNotNull(System.getProperty("TEST_RESOURCE_DIR"))).parentFile.parentFile.parentFile.parentFile.parentFile
        val profile = File(repository, "playwright/native-opened-file-session-fixture")
        val session = NativeCoreSession(JVMContentIO(profile.absolutePath), { error("Core must not open") }, this)
        try {
            session.startupSearch.updateQuery("сохранённый черновик")
            session.openPanel(NativeUserPanel.Settings)
            var canSave = false
            session.registerNavigationFlush { canSave }
            val file = NativeFilePick.Picked(NativeOpenedFile("public-sample.md", "text/markdown", "# Пример\n\nИсходный текст.".encodeToByteArray()))
            assertFalse(session.openFile(file))
            assertEquals(null, session.openedFile.value)
            canSave = true
            assertTrue(session.openFile(file))
            val opened = session.openedFile.value as NativeReaderContent.Document
            assertEquals("Пример", opened.title)
            assertEquals("Исходный текст.", opened.document.blocks.last().plainText())
            assertFalse(session.openFile(NativeFilePick.Cancelled))
            assertEquals(opened, session.openedFile.value)
            assertTrue(session.back())
            assertEquals(null, session.openedFile.value)
            assertEquals(NativeUserPanel.Settings, session.panel.value)
            assertEquals("сохранённый черновик", session.startupSearch.query)
            assertTrue(session.openFile(NativeFilePick.Failed("Файл недоступен")))
            assertEquals("Файл недоступен", (session.openedFile.value as NativeReaderContent.Unsupported).reason)
            for (destination in listOf<suspend () -> Unit>(
                { session.openPanel(NativeUserPanel.Settings) },
                { session.openCollections() },
                { session.showSearch(); Unit },
            )) {
                canSave = true
                assertTrue(session.openFile(file))
                canSave = false
                destination()
                assertTrue(session.openedFile.value is NativeReaderContent.Document)
                canSave = true
                destination()
                assertEquals(null, session.openedFile.value)
                assertEquals("сохранённый черновик", session.startupSearch.query)
            }
        } finally {
            session.close()
            if (profile.exists()) check(profile.deleteRecursively())
        }
    }
}
