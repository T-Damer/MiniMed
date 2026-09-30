package dev.localmed.nativespike.shared.designsystem

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf

/** One theme's generated tokens; components read them through [NativeDesign], never literals. */
@Immutable
data class NativeDesignTokens(
    val dark: Boolean,
    val colors: NativeColorTokens,
    val shadows: NativeShadowTokens,
)

val LightDesignTokens = NativeDesignTokens(dark = false, colors = LightColorTokens, shadows = LightShadowTokens)
val DarkDesignTokens = NativeDesignTokens(dark = true, colors = DarkColorTokens, shadows = DarkShadowTokens)

val LocalNativeDesignTokens = staticCompositionLocalOf { LightDesignTokens }

@Composable
fun ProvideNativeDesignTokens(dark: Boolean, content: @Composable () -> Unit) {
    CompositionLocalProvider(
        LocalNativeDesignTokens provides if (dark) DarkDesignTokens else LightDesignTokens,
        content = content,
    )
}

object NativeDesign {
    val tokens: NativeDesignTokens
        @Composable @ReadOnlyComposable get() = LocalNativeDesignTokens.current
    val colors: NativeColorTokens
        @Composable @ReadOnlyComposable get() = LocalNativeDesignTokens.current.colors
    val shadows: NativeShadowTokens
        @Composable @ReadOnlyComposable get() = LocalNativeDesignTokens.current.shadows
}
