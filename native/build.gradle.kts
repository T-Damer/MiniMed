// Root build file: declares plugin versions once, applied per-module below.
plugins {
    id("com.android.application") version "8.13.0" apply false
    id("com.android.library") version "8.13.0" apply false
    kotlin("multiplatform") version "2.2.10" apply false
    kotlin("plugin.compose") version "2.2.10" apply false
    // Pinned to 1.9.3, not the newer 1.1x line: Compose Multiplatform's Android artifacts track
    // androidx.compose versioning 1:1, and 1.10+ requires compileSdk 37 / AGP 9.1 (not installed;
    // matches apps/app/android's own compileSdk 36 ceiling — see ADR 0021).
    id("org.jetbrains.compose") version "1.9.3" apply false
}

tasks.register("clean", Delete::class) {
    delete(rootProject.layout.buildDirectory)
}
