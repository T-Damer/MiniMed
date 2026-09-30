package dev.localmed.nativespike.shared.ui

import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import dev.localmed.nativespike.shared.designsystem.DarkColorTokens
import dev.localmed.nativespike.shared.designsystem.LightColorTokens
import dev.localmed.nativespike.shared.designsystem.LightComponentStyles
import dev.localmed.nativespike.shared.designsystem.NativeColorTokens
import dev.localmed.nativespike.shared.designsystem.NativeFontFamilies
import dev.localmed.nativespike.shared.designsystem.NativeAppFrame
import dev.localmed.nativespike.shared.designsystem.NativePressShade
import androidx.compose.foundation.LocalIndication
import androidx.compose.material3.LocalRippleConfiguration
import dev.localmed.nativespike.shared.designsystem.ProvideNativeDesignTokens
import dev.localmed.nativespike.shared.designsystem.nativeMonoFontFamily

/**
 * Material colour schemes built from the generated WebView tokens (designsystem/DesignTokens.kt).
 * One deliberate deviation: native route text sits directly on the light route background, so it
 * uses a darker grey than the web `--theme-background` to keep 7:1 contrast (ThemeContrastTest).
 */
private val ReadableLightRouteBackground = Color(0xFF514E45)
private val LightRouteInk = Color(0xFFFFF8E6)

internal val LightColors = lightColorScheme(
    background = ReadableLightRouteBackground,
    onBackground = LightRouteInk,
    surface = LightColorTokens.surface,
    onSurface = LightColorTokens.text,
    surfaceVariant = LightColorTokens.surfaceRaised,
    onSurfaceVariant = LightColorTokens.textMuted,
    primary = LightColorTokens.accent,
    onPrimary = LightColorTokens.accentContrast,
    secondary = LightColorTokens.link,
    secondaryContainer = LightColorTokens.surfaceMuted,
    onSecondaryContainer = LightColorTokens.textMuted,
    error = LightColorTokens.danger,
    errorContainer = LightColorTokens.searchSurface,
    onErrorContainer = LightColorTokens.danger,
    outline = LightColorTokens.border,
    outlineVariant = LightColorTokens.border,
)

internal val DarkColors = darkColorScheme(
    background = DarkColorTokens.background,
    onBackground = DarkColorTokens.text,
    surface = DarkColorTokens.surface,
    onSurface = DarkColorTokens.text,
    surfaceVariant = DarkColorTokens.surfaceRaised,
    onSurfaceVariant = DarkColorTokens.textMuted,
    primary = DarkColorTokens.accent,
    onPrimary = DarkColorTokens.accentContrast,
    secondary = DarkColorTokens.link,
    secondaryContainer = DarkColorTokens.surfaceMuted,
    onSecondaryContainer = DarkColorTokens.textMuted,
    error = DarkColorTokens.danger,
    errorContainer = DarkColorTokens.searchSurface,
    onErrorContainer = DarkColorTokens.danger,
    outline = DarkColorTokens.border,
    outlineVariant = DarkColorTokens.border,
)

/** Web `.app-bottom-nav` surface and `.app-nav-button` ink (same in both web themes). */
internal val NativeNavigationSurface = LightComponentStyles.bottomNav.background
internal val NativeNavigationInk = LightComponentStyles.bottomNavButton.text.color

/**
 * Web `--font-serif` for headings, sans for body text and `--font-mono` (bundled Cascadia Code)
 * for the uppercase micro labels; numerals stay tabular. Callers uppercase stamp text themselves.
 */
private fun webTypography(mono: FontFamily): Typography {
    fun style(family: FontFamily, weight: FontWeight, size: Int, line: Int) =
        TextStyle(fontFeatureSettings = "tnum", fontFamily = family, fontWeight = weight, fontSize = size.sp, lineHeight = line.sp)
    val serif = NativeFontFamilies.serif
    val sans = NativeFontFamilies.sans
    return Typography(
        titleLarge = style(serif, FontWeight.Normal, 22, 28),
        titleMedium = style(serif, FontWeight.Normal, 17, 24),
        titleSmall = style(serif, FontWeight.Normal, 15, 21),
        bodyLarge = style(sans, FontWeight.Normal, 16, 26),
        bodyMedium = style(sans, FontWeight.Normal, 14, 20),
        bodySmall = style(sans, FontWeight.Normal, 13, 19),
        labelLarge = style(sans, FontWeight.Medium, 14, 20),
        labelMedium = style(sans, FontWeight.Medium, 12, 16),
        labelSmall = style(mono, FontWeight.Bold, 11, 14),
    )
}

private fun routeDeskTokens(dark: Boolean): NativeColorTokens = if (dark) DarkColorTokens else LightColorTokens

/** Web `--folder`: the route desk colour below the viewport-high gradient. */
@Composable
fun nativeRouteDeskColor(): Color = routeDeskTokens(nativeUserDarkTheme(LocalNativeTheme.current)).folder

/** The top colour of the route desk gradient, for chrome that sits over it. */
@Composable
fun nativeRouteDeskTopColor(): Color = routeDeskTokens(nativeUserDarkTheme(LocalNativeTheme.current)).folderLight

/** Web `--route-desk-gradient`: `--folder-light` to `--folder` over one viewport. */
@Composable
fun nativeRouteDeskBrush(): Brush {
    val tokens = routeDeskTokens(nativeUserDarkTheme(LocalNativeTheme.current))
    return Brush.verticalGradient(listOf(tokens.folderLight, tokens.folder))
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun NativeSpikeTheme(content: @Composable () -> Unit) {
    val dark = nativeUserDarkTheme(LocalNativeTheme.current)
    val colors = if (dark) DarkColors else LightColors
    val mono = nativeMonoFontFamily()
    val typography = remember(mono) { webTypography(mono) }
    ProvideNativeDesignTokens(dark) {
        MaterialTheme(colorScheme = colors, typography = typography) {
            // No Material ripple anywhere: raised controls sink when pressed (nativePressBox),
            // everything else shades faintly (NativePressShade).
            CompositionLocalProvider(
                LocalContentColor provides colors.onSurface,
                LocalIndication provides NativePressShade,
                LocalRippleConfiguration provides null,
            ) {
                // One centred page on wide windows, desk on both sides (web page width).
                NativeAppFrame(nativeRouteDeskBrush(), content)
            }
        }
    }
}
