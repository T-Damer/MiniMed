package dev.localmed.nativespike.shared.designsystem

import androidx.compose.runtime.Composable
import androidx.compose.ui.text.font.FontFamily
import minimed_native_spike.shared.generated.resources.Res
import minimed_native_spike.shared.generated.resources.cascadia_code_regular
import org.jetbrains.compose.resources.Font

/**
 * The WebView font stacks as the Android WebView resolves them: Georgia and Arial are absent on
 * Android, so headings fall back to the platform serif and body text to the platform sans, exactly
 * as FontFamily.Serif/SansSerif do here. `--font-mono` uses the bundled Cascadia Code
 * (theme.css `MiniMed Digits`/`MiniMed Code`). The web applies Cascadia to digits only and lets
 * stamp letters fall back to the platform monospace; Compose has no unicode-range fallback, so
 * native mono text is Cascadia throughout (it covers Cyrillic).
 */
object NativeFontFamilies {
    val serif: FontFamily = FontFamily.Serif
    val sans: FontFamily = FontFamily.SansSerif
}

@Composable
fun nativeMonoFontFamily(): FontFamily = FontFamily(Font(Res.font.cascadia_code_regular))
