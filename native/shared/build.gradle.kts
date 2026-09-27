// Shared KMP module: search domain logic (text normalization, FTS query building, grouping) and
// the Compose Multiplatform UI, both in commonMain. Only androidTarget() is wired to an actual
// platform implementation for this spike (see ADR 0021). The commented targets below show what a
// real multi-platform rollout would add and exactly what each needs — nothing here should be read
// as "already supported".
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

    // --- Desktop (JVM) target — would let the same search UI run on macOS/Linux/Windows. ---
    // Needs: `jvm("desktop")` target + a `desktopMain` source set depending on
    // `compose.desktop.currentOs`, an `androidx.sqlite.driver.bundled` JVM artifact (same
    // coordinate works on JVM), and a `native/desktopApp` module with a `main()` that calls
    // `application { Window { App() } }`. No native toolchain required — JDK 17+ only.
    // jvm("desktop")

    // --- iOS (arm64 device + simulator) — would let the same UI run on iPhone/iPad. ---
    // Needs: full Xcode (not just Command Line Tools — absent on this machine: `xcode-select -p`
    // resolves to CommandLineTools only), the Kotlin/Native iOS toolchain it drives, a
    // `native/iosApp` Xcode project embedding the shared framework via
    // `binaries.framework { baseName = "shared" }`, and an `actual` SQLite binding — androidx.sqlite
    // has no iOS driver, so this would need SQLDelight's native driver or a direct SQLite3 cinterop
    // against the platform's bundled libsqlite3 (which historically ships without FTS5 enabled on
    // iOS' system library — would likely need a vendored SQLite build, same tradeoff SQLDelight/
    // GRDB users hit today).
    // iosArm64(); iosSimulatorArm64()

    // --- Web (Kotlin/Wasm) — would let the search UI run in a browser via Compose HTML/Wasm. ---
    // Needs: `wasmJs { browser() }` target, and — the hard part — FTS5 SQLite in the browser, which
    // means shipping a wa-sqlite/sql.js-style WASM SQLite build (OPFS-backed) since there is no
    // browser-native SQLite; this is exactly the engine the existing web app already uses via
    // packages/storage-sqlite, so a Wasm target here would likely call back into that, not
    // reimplement it.
    // wasmJs { browser() }

    sourceSets {
        val commonMain by getting {
            dependencies {
                // `api`, not `implementation`: androidApp calls into commonMain Composables
                // (NativeSearchSpikeApp) directly, so it needs these types (and the @Composable
                // annotation class) on its own compile classpath, not just shared's internal one.
                api(compose.runtime)
                api(compose.foundation)
                api(compose.material3)
                api(compose.ui)
                api(compose.components.resources)
                api("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
            }
        }
        val androidMain by getting {
            dependencies {
                implementation("androidx.sqlite:sqlite:2.7.1")
                implementation("androidx.sqlite:sqlite-bundled:2.7.1")
                api("androidx.activity:activity-compose:1.11.0")
                implementation("androidx.core:core-ktx:1.17.0")
            }
        }
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
