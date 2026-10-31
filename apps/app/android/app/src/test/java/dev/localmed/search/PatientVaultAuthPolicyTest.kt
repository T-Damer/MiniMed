package dev.localmed.search

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PatientVaultAuthPolicyTest {
    @Test
    fun authBoundKeyNeedsASecureLockScreenAndApi29() {
        assertTrue(PatientVaultAuthPolicy.authSupported(29, true))
        assertTrue(PatientVaultAuthPolicy.authSupported(36, true))
        assertFalse(PatientVaultAuthPolicy.authSupported(36, false))
        assertFalse(PatientVaultAuthPolicy.authSupported(28, true))
        assertFalse(PatientVaultAuthPolicy.authSupported(24, true))
    }

    @Test
    fun aClosedPromptIsACancellationNotAFailure() {
        for (code in intArrayOf(5, 10, 13)) {
            assertEquals(
                PatientVaultAuthPolicy.PromptFailure.CANCELLED,
                PatientVaultAuthPolicy.classifyPromptError(code),
            )
        }
        assertEquals("AUTH_CANCELLED", PatientVaultAuthPolicy.PromptFailure.CANCELLED.code)
    }

    @Test
    fun aMissingLockScreenIsUnavailableAndLockoutIsFailed() {
        for (code in intArrayOf(1, 11, 12, 14)) {
            assertEquals(
                PatientVaultAuthPolicy.PromptFailure.UNAVAILABLE,
                PatientVaultAuthPolicy.classifyPromptError(code),
            )
        }
        for (code in intArrayOf(7, 9, 3, 99)) {
            assertEquals(
                PatientVaultAuthPolicy.PromptFailure.FAILED,
                PatientVaultAuthPolicy.classifyPromptError(code),
            )
        }
    }

    @Test
    fun protectionDefaultsToTheDeviceKeyAndRejectsUnknownNames() {
        assertEquals("device", PatientVaultAuthPolicy.normalizeProtection(null))
        assertEquals("device", PatientVaultAuthPolicy.normalizeProtection("device"))
        assertEquals("auth", PatientVaultAuthPolicy.normalizeProtection("auth"))
        assertNull(PatientVaultAuthPolicy.normalizeProtection("biometric"))
    }

    @Test
    fun theDeviceKeyIsRetiredOnlyBesideAnAuthKey() {
        assertTrue(PatientVaultAuthPolicy.mayRetireDeviceKey(true))
        assertFalse(PatientVaultAuthPolicy.mayRetireDeviceKey(false))
    }
}
