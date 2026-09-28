// Desktop (JVM) host for the shared search UI — proves the same commonMain Composables and the
// same androidx.sqlite-bundled FTS5 engine run on a plain JVM (macOS here), not just Android.
// See ADR 0021 / docs/research/native-vs-webview-2026-09-28.md, "Multiplatform build and tests".
plugins {
    kotlin("jvm")
    id("org.jetbrains.compose")
    kotlin("plugin.compose")
}

dependencies {
    implementation(project(":shared"))
    implementation(compose.desktop.currentOs)
}

compose.desktop {
    application {
        mainClass = "dev.localmed.nativespike.desktopapp.MainKt"
        nativeDistributions {
            targetFormats(org.jetbrains.compose.desktop.application.dsl.TargetFormat.Dmg)
            packageName = "MiniMed Native Spike"
            packageVersion = "1.0.0"
        }
    }
}

// No explicit jvmToolchain(17): that triggers Gradle's toolchain auto-provisioning, which is not
// configured (no download repository) and this machine has no standalone JDK 17 for it to find —
// only JDK 21 (pinned as the Gradle daemon's own JVM via gradle.properties' org.gradle.java.home)
// and JDK 26. Compiling with whatever JDK the daemon already runs on (21) is fine for a desktop-
// only spike app.
