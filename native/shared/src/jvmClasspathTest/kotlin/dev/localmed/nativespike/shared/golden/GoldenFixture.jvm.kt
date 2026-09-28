package dev.localmed.nativespike.shared.golden

import java.io.File

/**
 * Shared by desktop (JVM) and Android unit tests — both run on a plain JVM. Reads the absolute
 * path from a system property the Gradle test task sets (`shared/build.gradle.kts`,
 * `tasks.withType<Test>`), not a classpath resource lookup: KMP's `commonTest/resources` ->
 * per-target-test-resource merging behavior for `androidUnitTest` specifically was not something
 * this spike wanted to depend on sight-unseen, so both platforms use the exact same
 * absolute-file-path mechanism the iOS actual (`GoldenFixture.ios.kt`) also uses, for one
 * consistent story across every non-wasm target.
 */
actual fun readGoldenFixture(): String {
    val path = System.getProperty("GOLDEN_FIXTURE_PATH")
        ?: error(
            "GOLDEN_FIXTURE_PATH system property not set — the Gradle test task must set it " +
                "(see shared/build.gradle.kts, tasks.withType<Test>).",
        )
    val file = File(path)
    if (!file.exists()) error("GOLDEN_FIXTURE_PATH points to a missing file: $path")
    return file.readText(Charsets.UTF_8)
}
