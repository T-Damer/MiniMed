// The launchable Android app for the native search spike. A different applicationId from the
// Capacitor app (dev.localmed.search) so both can be installed side by side on the same phone —
// see ADR 0021 / AGENTS.md rule on not touching the user's installed release.
plugins {
    id("com.android.application")
    kotlin("android")
    kotlin("plugin.compose")
}

android {
    namespace = "dev.localmed.nativespike.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.localmed.nativespike"
        // 26, not shared's 24: this app module only ships an adaptive launcher icon
        // (mipmap-anydpi-v26); the test device is API 36 either way.
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-spike"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildTypes {
        // Debug-signed "release-like" build for the measurement phase: minified + resource
        // shrunk (R8), same idea as the task's request to compare against a release-shaped web
        // bundle. Still signed with the default debug key — no production signing key is used or
        // available here.
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
        }
    }

    packaging {
        resources.excludes.add("META-INF/**")
    }
}

dependencies {
    implementation(project(":shared"))
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-compose:1.11.0")
}
