package dev.localmed.nativespike.shared.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** WebView theme.css/theme-dark.css paper, desk and typography tokens.
 * Platform sans/serif/mono supply the Web font-stack fallbacks; numerals stay tabular. */
private object WebTokens {
    // Web paper palette; native route chrome uses a darker grey for >=7:1 text contrast.
    val lightBackground = Color(0xFF514E45)
    val lightSurface = Color(0xFFF3ECD9)
    val lightSurfaceRaised = Color(0xFFFBF7EA)
    val lightSurfaceMuted = Color(0xFFE6DCC4)
    val lightBorder = Color(0xFFCBC0A7)
    val lightText = Color(0xFF292720)
    val lightTextMuted = Color(0xFF585349)
    val lightTextFaint = Color(0xFF615B50)
    val lightAccent = Color(0xFF405B4E)
    val lightAccentContrast = Color(0xFFF8F0DD)
    val lightLink = Color(0xFF355B49)
    val lightDanger = Color(0xFF87453C)
    val lightSearchSurface = Color(0xFFF7EDCF)

    // --- Dark (theme-dark.css) ---
    val darkBackground = Color(0xFF211B17)
    val darkSurface = Color(0xFF2D2721)
    val darkSurfaceRaised = Color(0xFF372E26)
    val darkSurfaceMuted = Color(0xFF251F1A)
    val darkBorder = Color(0xFF594735)
    val darkText = Color(0xFFEEE5D4)
    val darkTextMuted = Color(0xFFC8BCA8)
    val darkTextFaint = Color(0xFFB5A88F)
    val darkAccent = Color(0xFF82A88D)
    val darkAccentContrast = Color(0xFF1C1712)
    val darkLink = Color(0xFF9BC7A7)
    val darkDanger = Color(0xFFD98578)
    val darkSearchSurface = Color(0xFF243029)
}

internal val NativeNavigationSurface = Color(0xF03A3933)
internal val NativeNavigationInk = Color(0xFFD5CDBC)

internal val LightColors = lightColorScheme(
    background = WebTokens.lightBackground,
    onBackground = Color(0xFFFFF8E6),
    surface = WebTokens.lightSurface,
    onSurface = WebTokens.lightText,
    surfaceVariant = WebTokens.lightSurfaceRaised,
    onSurfaceVariant = WebTokens.lightTextMuted,
    primary = WebTokens.lightAccent,
    onPrimary = WebTokens.lightAccentContrast,
    secondary = WebTokens.lightLink,
    secondaryContainer = WebTokens.lightSurfaceMuted,
    onSecondaryContainer = WebTokens.lightTextMuted,
    error = WebTokens.lightDanger,
    errorContainer = WebTokens.lightSearchSurface,
    onErrorContainer = WebTokens.lightDanger,
    outline = WebTokens.lightBorder,
    outlineVariant = WebTokens.lightBorder,
)

internal val DarkColors = darkColorScheme(
    background = WebTokens.darkBackground,
    onBackground = WebTokens.darkText,
    surface = WebTokens.darkSurface,
    onSurface = WebTokens.darkText,
    surfaceVariant = WebTokens.darkSurfaceRaised,
    onSurfaceVariant = WebTokens.darkTextMuted,
    primary = WebTokens.darkAccent,
    onPrimary = WebTokens.darkAccentContrast,
    secondary = WebTokens.darkLink,
    secondaryContainer = WebTokens.darkSurfaceMuted,
    onSecondaryContainer = WebTokens.darkTextMuted,
    error = WebTokens.darkDanger,
    errorContainer = WebTokens.darkSearchSurface,
    onErrorContainer = WebTokens.darkDanger,
    outline = WebTokens.darkBorder,
    outlineVariant = WebTokens.darkBorder,
)

/** Web's `--font-serif` for headings (document/section titles), `--font-mono` for the uppercase
 * micro labels (kind stamps, section paths), sans for everything else — see file header. */
private val WebTypography = Typography(
    titleLarge = TextStyle(fontFeatureSettings = "tnum", fontFamily = FontFamily.Serif, fontWeight = FontWeight.Normal, fontSize = 22.sp, lineHeight = 28.sp),
    titleMedium = TextStyle(fontFeatureSettings = "tnum", fontFamily = FontFamily.Serif, fontWeight = FontWeight.Normal, fontSize = 17.sp, lineHeight = 24.sp),
    titleSmall = TextStyle(fontFeatureSettings = "tnum", fontFamily = FontFamily.Serif, fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 21.sp),
    bodyLarge = TextStyle(fontFeatureSettings = "tnum", fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Normal, fontSize = 16.sp, lineHeight = 26.sp),
    bodyMedium = TextStyle(fontFeatureSettings = "tnum", fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontFeatureSettings = "tnum", fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Normal, fontSize = 13.sp, lineHeight = 19.sp),
    labelLarge = TextStyle(fontFeatureSettings = "tnum", fontFamily = FontFamily.Default, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 20.sp),
    labelMedium = TextStyle(fontFeatureSettings = "tnum", fontFamily = FontFamily.Default, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp),
    // Web's ".category-stamp"/".result-path": mono, uppercase, ~11px, letter-spaced — callers add
    // textTransform-equivalent (String.uppercase()) and letterSpacing themselves since Compose
    // Typography has no built-in text-transform.
    labelSmall = TextStyle(fontFeatureSettings = "tnum", fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 11.sp, lineHeight = 14.sp),
)

/** Actual route desk tokens: the gradient spans the viewport, independently of content height. */
@Composable
fun nativeRouteDeskColor(): Color = if (nativeUserDarkTheme(LocalNativeTheme.current)) Color(0xFF2E261F) else Color(0xFFB9A06A)

@Composable
fun nativeRouteDeskBrush(): Brush = Brush.verticalGradient(listOf(
    if (nativeUserDarkTheme(LocalNativeTheme.current)) Color(0xFF342C23) else Color(0xFFCBB37C), nativeRouteDeskColor(),
))

@Composable
fun NativeSpikeTheme(content: @Composable () -> Unit) {
    val colors = if (nativeUserDarkTheme(LocalNativeTheme.current)) DarkColors else LightColors
    MaterialTheme(colorScheme = colors, typography = WebTypography) {
        CompositionLocalProvider(LocalContentColor provides colors.onSurface, content = content)
    }
}
