package dev.localmed.search

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CameraCapturePolicyTest {
    @Test
    fun onlyPlainTokensBecomeFileNames() {
        assertTrue(CameraCapturePolicy.isValidId("3f1c2a9e-1b2c-4d5e-8f90-123456789abc"))
        assertTrue(CameraCapturePolicy.isValidId("abcdefgh"))
        assertFalse(CameraCapturePolicy.isValidId(null))
        assertFalse(CameraCapturePolicy.isValidId(""))
        assertFalse(CameraCapturePolicy.isValidId("short"))
        assertFalse(CameraCapturePolicy.isValidId("../../databases/vault"))
        assertFalse(CameraCapturePolicy.isValidId("a/b/c/d/e/f/g/h"))
        assertFalse(CameraCapturePolicy.isValidId("x".repeat(65)))
    }

    @Test
    fun photosLiveUnderTheCameraCacheDirectory() {
        val file = CameraCapturePolicy.photoFile(File("/cache"), "abcdefgh-1234")
        assertEquals(File("/cache/localmed/camera/abcdefgh-1234.jpg"), file)
    }

    @Test
    fun aPhotoIsStaleAfterADay() {
        val now = 10L * 24 * 60 * 60 * 1000
        assertFalse(CameraCapturePolicy.isStale(now - 60_000, now))
        assertTrue(CameraCapturePolicy.isStale(now - 25L * 60 * 60 * 1000, now))
    }

    @Test
    fun purposeIsEcgOrSkinOnly() {
        assertEquals("ecg", CameraCapturePolicy.normalizePurpose("ecg"))
        assertEquals("skin", CameraCapturePolicy.normalizePurpose("skin"))
        assertNull(CameraCapturePolicy.normalizePurpose("other"))
        assertNull(CameraCapturePolicy.normalizePurpose(null))
    }
}
