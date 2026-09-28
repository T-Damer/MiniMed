package dev.localmed.nativespike.shared.golden

/**
 * Reads `search-golden.json` (checked in at `native/shared/src/commonTest/resources/`, generated
 * by `tools/benchmarks/src/export-search-golden.ts --corpus=core`) as raw text. One `expect`, one
 * `actual` per platform family, because "a commonTest resource" means something different on each:
 *  - JVM (desktop) and Android unit tests both run on a plain JVM classloader, so they share one
 *    `actual` (see the `jvmClasspathTest` intermediate source set in shared/build.gradle.kts) that
 *    reads it as a classpath resource.
 *  - iOS has no classpath; the absolute path is passed in via an environment variable the
 *    `iosSimulatorArm64Test`/`iosArm64Test` Gradle tasks set explicitly (see shared/build.gradle.kts).
 *  - wasmJs: not implemented — loading a file into a Karma-run browser test needs either a fetch()
 *    (async, awkward from a sync `expect fun`) or a webpack copy-plugin step neither of which was
 *    set up for this spike; the `actual` throws a clear, honest "not verified on wasmJs" error
 *    instead of silently returning nothing.
 */
expect fun readGoldenFixture(): String
