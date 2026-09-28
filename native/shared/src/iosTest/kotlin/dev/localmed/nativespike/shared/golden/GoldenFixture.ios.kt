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
 * iOS has no JVM classpath and no `System.getProperty`. Values are passed in as environment
 * variables the `iosSimulatorArm64Test`/`iosArm64Test` Gradle tasks set explicitly
 * (`shared/build.gradle.kts`) — the simulator test runner forwards the host process's environment
 * to the simulator process, so this Just Works without bundling files into the test binary via an
 * Xcode resource step (which this spike's Gradle-only setup doesn't have).
 */
@OptIn(ExperimentalForeignApi::class)
actual fun readTestEnvironmentValue(name: String): String? {
    val env = NSProcessInfo.processInfo.environment
    // `xcrun simctl spawn` (what actually runs the test binary on the Simulator) only forwards
    // host env vars prefixed `SIMCTL_CHILD_` into the spawned process — see shared/build.gradle.kts
    // for why both names are set there. Check the prefixed one first since that's the one the
    // Simulator path actually receives.
    return (env["SIMCTL_CHILD_$name"] as? String) ?: (env[name] as? String)
}

/** Reads via plain POSIX `fopen`/`fread` rather than `NSString(contentsOfFile:)`, to avoid
 * depending on the exact Kotlin/Native Foundation-interop signature for that factory method. */
@OptIn(ExperimentalForeignApi::class)
actual fun readFileAtPath(path: String): String {
    val file = fopen(path, "rb") ?: error("Missing/unreadable file: $path")
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
