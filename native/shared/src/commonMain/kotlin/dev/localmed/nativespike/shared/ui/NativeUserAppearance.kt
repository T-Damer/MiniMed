package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import dev.localmed.nativespike.shared.user.NativeThemePreference
import dev.localmed.nativespike.shared.user.NativeUserPreferences

internal val LocalNativeTheme = staticCompositionLocalOf { NativeThemePreference.System }

@Composable
fun nativeUserDarkTheme(preference: NativeThemePreference): Boolean = when (preference) {
    NativeThemePreference.System -> isSystemInDarkTheme()
    NativeThemePreference.Light -> false
    NativeThemePreference.Dark -> true
}

@Composable
fun NativeUserAppearance(preferences: NativeUserPreferences, content: @Composable () -> Unit) {
    val systemDensity = LocalDensity.current
    CompositionLocalProvider(
        LocalNativeTheme provides preferences.theme,
        LocalDensity provides Density(systemDensity.density, systemDensity.fontScale * preferences.textScalePercent / 100f),
        content = content,
    )
}
