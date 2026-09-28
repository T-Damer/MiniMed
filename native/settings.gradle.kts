// Native search spike (ADR 0021). Standalone Gradle KMP project — deliberately NOT wired into
// the root Bun/TS workspace or apps/app/android. See docs/adr/0021-native-search-spike-kmp.md.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    // PREFER_PROJECT, not FAIL_ON_PROJECT_REPOS: the wasmJs target's Kotlin/JS tooling adds its
    // own project-level ivy repository at configuration time (nodejs.org/dist) to fetch the
    // Node.js distribution needed for `wasmJsBrowserTest` (Karma + headless Chrome) — legitimate,
    // not a dependency-hygiene problem. PREFER_SETTINGS still blocked it (the project repo was
    // added by "unknown code" outside Gradle's normal repository-declaration tracking, so
    // "prefer settings" resolved to "settings only" for that lookup and 404'd against Maven
    // Central/google() instead of nodejs.org).
    repositoriesMode.set(RepositoriesMode.PREFER_PROJECT)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "minimed-native-spike"

include(":shared")
include(":androidApp")
include(":desktopApp")
