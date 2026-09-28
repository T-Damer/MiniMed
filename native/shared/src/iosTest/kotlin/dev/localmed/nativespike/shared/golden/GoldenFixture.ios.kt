package dev.localmed.nativespike.shared.golden

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import platform.Foundation.NSProcessInfo
import platform.posix.SEEK_END
import platform.posix.SEEK_SET
import platform.posix.fclose
import platform.posix.fopen
import platform.posix.fread
import platform.posix.fseek
import platform.posix.ftell

/**
 * iOS has no JVM classpath. The absolute path to `search-golden.json` is passed in as an
 * environment variable the `iosSimulatorArm64Test`/`iosArm64Test` Gradle tasks set explicitly
 * (`shared/build.gradle.kts`) — the simulator test runner forwards the host process's environment
 * to the simulator process, so this Just Works without bundling the file into the test binary via
 * an Xcode resource step (which this spike's Gradle-only setup doesn't have). Reads via plain
 * POSIX `fopen`/`fread` rather than `NSString(contentsOfFile:)` to avoid depending on the exact
 * Kotlin/Native Foundation-interop signature for that factory method.
 */
@OptIn(ExperimentalForeignApi::class)
actual fun readGoldenFixture(): String {
    // `xcrun simctl spawn` (what actually runs the test binary on the Simulator) only forwards
    // host env vars prefixed `SIMCTL_CHILD_` into the spawned process — see shared/build.gradle.kts
    // for why both names are set there. Check the prefixed one first since that's the one the
    // Simulator path actually receives.
    val env = NSProcessInfo.processInfo.environment
    val path = (env["SIMCTL_CHILD_GOLDEN_FIXTURE_PATH"] as? String)
        ?: (env["GOLDEN_FIXTURE_PATH"] as? String)
        ?: error(
            "Neither SIMCTL_CHILD_GOLDEN_FIXTURE_PATH nor GOLDEN_FIXTURE_PATH environment " +
                "variable is set — the Gradle iosXTest task must set it (see shared/build.gradle.kts).",
        )
    val file = fopen(path, "rb")
        ?: error("GOLDEN_FIXTURE_PATH points to a missing/unreadable file: $path")
    try {
        fseek(file, 0, SEEK_END)
        val size = ftell(file)
        fseek(file, 0, SEEK_SET)
        val bytes = ByteArray(size.toInt())
        bytes.usePinned { pinned ->
            fread(pinned.addressOf(0), 1u, size.toULong(), file)
        }
        return bytes.decodeToString()
    } finally {
        fclose(file)
    }
}
