package dev.localmed.nativespike.shared.golden

import java.io.File

/** Shared by desktop (JVM) and Android unit tests — both run on a plain JVM. See GoldenFixture.kt. */
actual fun readTestEnvironmentValue(name: String): String? = System.getProperty(name)

actual fun readFileAtPath(path: String): String {
    val file = File(path)
    if (!file.exists()) error("Missing file: $path")
    return file.readText(Charsets.UTF_8)
}
