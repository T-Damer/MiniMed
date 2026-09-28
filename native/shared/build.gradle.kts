// Shared KMP module: search domain logic (text normalization, FTS query building, grouping) and
// the Compose Multiplatform UI, both in commonMain. See ADR 0021 for what each target below
// actually proves vs. what remains a stated limitation (web has no real SQLite — see wasmJsMain).
@file:OptIn(org.jetbrains.kotlin.gradle.ExperimentalWasmDsl::class)

plugins {
    kotlin("multiplatform")
    id("com.android.library")
    id("org.jetbrains.compose")
    kotlin("plugin.compose")
}

kotlin {
    androidTarget {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    // Desktop (JVM): androidx.sqlite-bundled publishes a real `jvm` variant (confirmed against its
    // Gradle Module Metadata — see docs/research/native-vs-webview-2026-09-28.md, "Multiplatform
    // build and tests"), so this is genuine FTS5 SQLite on macOS/Linux/Windows, not a stub.
    jvm("desktop") {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    // iOS: androidx.sqlite-bundled also publishes `iosArm64`/`iosSimulatorArm64` variants (same
    // metadata check) — real FTS5 SQLite here too. Requires the full Xcode toolchain (not just
    // Command Line Tools) to link; this machine has Xcode 26.6 at /Applications/Xcode.app, reached
    // via `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` without changing the system's
    // `xcode-select` pointer (a system-settings change this session does not make).
    iosArm64 {
        binaries.framework { baseName = "shared" }
    }
    iosSimulatorArm64 {
        binaries.framework { baseName = "shared" }
    }

    // Web (Kotlin/Wasm): no `wasmJs`/`js` variant exists for androidx.sqlite-bundled (confirmed —
    // same metadata check found only android/jvm/ios/linux/macos/tvos/watchos). There is no
    // browser-native SQLite either. wasmJsMain's `NativeSearchDatabase` actual is therefore an
    // explicit, labelled STUB over a tiny in-memory sample — see its file header. It proves the
    // Compose UI renders in a browser via Kotlin/Wasm; it does not prove FTS5 search works there.
    // Note on AGENTS.md's "bind local dev servers to 127.0.0.1" rule: this spike only runs
    // `wasmJsBrowserDistribution` (a static build, no server) and `wasmJsBrowserTest` (Karma's
    // transient headless-Chrome test server, which defaults to localhost and exits with the test
    // process). `wasmJsBrowserRun`'s persistent webpack-dev-server is not used here; if it ever
    // is, its host must be pinned to 127.0.0.1 explicitly before running it on a shared machine.
    wasmJs {
        browser()
        binaries.executable()
    }

    sourceSets {
        val commonMain by getting {
            dependencies {
                // `api`, not `implementation`: the leaf app modules (androidApp, desktopApp, the
                // wasmJs entry point) call into commonMain Composables directly, so they need
                // these types (and the @Composable annotation class) on their own classpath.
                api(compose.runtime)
                api(compose.foundation)
                api(compose.material3)
                api(compose.ui)
                api(compose.components.resources)
                api("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
            }
        }
        val commonTest by getting {
            dependencies {
                implementation(kotlin("test"))
            }
        }
        // One `NativeSearchDatabase` actual shared by Android, desktop and iOS: androidx.sqlite's
        // API is identical across all three (Gradle Module Metadata confirms `androidJvm`, `jvm`,
        // `iosArm64` and `iosSimulatorArm64` variants all exist), so there is nothing
        // platform-specific left to write per target — see the file's own header comment.
        val sqliteBundledMain by creating {
            dependsOn(commonMain)
            dependencies {
                implementation("androidx.sqlite:sqlite:2.6.2")
                implementation("androidx.sqlite:sqlite-bundled:2.6.2")
            }
        }
        val androidMain by getting {
            dependsOn(sqliteBundledMain)
            dependencies {
                api("androidx.activity:activity-compose:1.11.0")
                implementation("androidx.core:core-ktx:1.17.0")
            }
        }
        val desktopMain by getting {
            dependsOn(sqliteBundledMain)
        }
        val iosArm64Main by getting
        val iosSimulatorArm64Main by getting
        val iosMain by creating {
            dependsOn(sqliteBundledMain)
            iosArm64Main.dependsOn(this)
            iosSimulatorArm64Main.dependsOn(this)
        }
        val iosArm64Test by getting
        val iosSimulatorArm64Test by getting
        val iosTest by creating {
            dependsOn(commonTest)
            iosArm64Test.dependsOn(this)
            iosSimulatorArm64Test.dependsOn(this)
        }
        val wasmJsMain by getting
    }
}

android {
    namespace = "dev.localmed.nativespike.shared"
    compileSdk = 36
    defaultConfig {
        minSdk = 24
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

