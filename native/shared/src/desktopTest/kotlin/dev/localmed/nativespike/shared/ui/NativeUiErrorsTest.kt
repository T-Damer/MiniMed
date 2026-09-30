package dev.localmed.nativespike.shared.ui

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.assertFailsWith
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking

class NativeUiErrorsTest {
    @Test fun failureSurvivesUnrelatedSuccessAndRetryExecutesOnlyCurrentAction() = runBlocking {
        val errors = NativeUiErrors()
        var snapshot = 1
        val attempts = mutableListOf<Int>()
        assertFalse(errors.execute(NativeUiOperation.SearchPosition, "Cannot save current search") { attempts += snapshot; error("disk write failed") })
        assertTrue(errors.execute(NativeUiOperation.ReaderPosition, "Cannot save reader") { })
        assertEquals("Cannot save current search", errors.messages.value[NativeUiOperation.SearchPosition])
        snapshot = 2
        var saved = 0
        assertTrue(errors.execute(NativeUiOperation.SearchPosition, "Cannot save current search") { attempts += snapshot; saved = snapshot })
        assertEquals(2, saved)
        assertEquals(listOf(1, 2), attempts)
        assertTrue(errors.messages.value.isEmpty())
    }
    @Test fun cancellationDoesNotBecomeAFalseIoErrorOrClearAnExistingFailure() = runBlocking {
        val errors = NativeUiErrors()
        errors.report(NativeUiOperation.Navigation, "Cannot save transition")
        assertFailsWith<CancellationException> {
            errors.execute(NativeUiOperation.Navigation, "False cancellation error") { throw CancellationException("superseded") }
        }
        assertEquals("Cannot save transition", errors.messages.value[NativeUiOperation.Navigation])
    }
}
