@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package dev.localmed.nativespike.shared.core

import kotlinx.coroutines.runBlocking
import platform.Foundation.NSData
import platform.Foundation.NSFileManager
import platform.Foundation.NSProcessInfo
import platform.Foundation.NSUUID
import platform.Foundation.create
import platform.Foundation.writeToFile
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class IOSNativeContentIOTest {
    @Test
    fun privateFilesHashesAndBoundedGzip() = runBlocking {
        val artifacts = NSProcessInfo.processInfo.environment["MINIMED_TEST_ARTIFACT_DIR"] as? String
            ?: error("Set MINIMED_TEST_ARTIFACT_DIR to the project's ignored playwright directory")
        val root = "$artifacts/ios-io-${NSUUID().UUIDString}"
        val io = IOSNativeContentIO(root)
        val sha = "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        try {
            io.writeTextAtomic("state/value.txt", "abc")
            assertEquals("abc", io.readText("state/value.txt"))
            io.verify("state/value.txt", sha, 3)
            assertFailsWith<NativeContentVerificationException> { io.verify("state/value.txt", sha, 2) }
            assertFailsWith<IllegalArgumentException> { io.exists("../outside") }
            val gzip = NSData.create(base64EncodedString = "H4sIAAAAAAAAE0tMSgYAwkEkNQMAAAA=", options = 0u)
                ?: error("Invalid test gzip")
            assertTrue(gzip.writeToFile(io.databasePath("fixture.gz"), true))
            io.decodeGzip("fixture.gz", "decoded.db", 3)
            io.verify("decoded.db", sha, 3)
            assertFailsWith<IllegalStateException> { io.decodeGzip("fixture.gz", "oversize.db", 2) }
            io.moveAtomic("decoded.db", "activated.db")
            assertTrue(io.exists("activated.db"))
            io.verify("activated.db", sha, 3)
        } finally {
            check(NSFileManager.defaultManager.removeItemAtPath(root, null))
        }
    }
}
