package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

// A plain Material 3 scheme (light + dark), deliberately not the web app's Obsidian-inspired
// theme — this spike is about engine/rendering perf, not visual parity.
private val LightColors = lightColorScheme(
    primary = androidx.compose.ui.graphics.Color(0xFF0B6E4F),
    secondary = androidx.compose.ui.graphics.Color(0xFF4A6363),
)

private val DarkColors = darkColorScheme(
    primary = androidx.compose.ui.graphics.Color(0xFF7DDCB0),
    secondary = androidx.compose.ui.graphics.Color(0xFFB0CCCC),
)

@Composable
fun NativeSpikeTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) DarkColors else LightColors
    MaterialTheme(colorScheme = colors, content = content)
}
