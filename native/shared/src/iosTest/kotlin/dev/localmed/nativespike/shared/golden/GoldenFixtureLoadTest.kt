package dev.localmed.nativespike.shared.golden

import kotlin.test.Test
import kotlin.test.assertTrue

/** iOS counterpart of the same check in `jvmClasspathTest` — see that file's header. */
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
