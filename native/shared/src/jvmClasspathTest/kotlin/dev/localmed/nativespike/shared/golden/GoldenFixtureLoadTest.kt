package dev.localmed.nativespike.shared.golden

import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Proves `readGoldenFixture()` reaches the real file (desktop + Android, see
 * `jvmClasspathTest`'s header). Not a parity check — stage 3's job, once the Kotlin port exists.
 * wasmJs deliberately has no equivalent test (its actual throws by design — see
 * `GoldenFixture.wasmJs.kt`); putting this in `commonTest` would make `wasmJsBrowserTest` fail
 * instead of simply not covering the fixture, so it lives here and in `iosTest` instead.
 */
class GoldenFixtureLoadTest {
    @Test
    fun golden_fixture_loads_and_looks_like_the_real_export() {
        val text = readGoldenFixture()
        assertTrue(text.startsWith("{"), "expected a JSON object, got: ${text.take(40)}")
        assertTrue("\"corpus\"" in text, "missing the corpus field export-search-golden.ts writes")
        assertTrue("\"queries\"" in text, "missing the queries array")
        assertTrue(text.length > 100_000, "suspiciously short for 142 queries: ${text.length} chars")
    }
}
