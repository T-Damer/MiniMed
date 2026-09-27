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
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "minimed-native-spike"

include(":shared")
include(":androidApp")
