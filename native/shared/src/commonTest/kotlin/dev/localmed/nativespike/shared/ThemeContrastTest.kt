package dev.localmed.nativespike.shared

import androidx.compose.ui.graphics.Color
import dev.localmed.nativespike.shared.ui.DarkColors
import dev.localmed.nativespike.shared.ui.LightColors
import kotlin.math.pow
import kotlin.test.Test
import kotlin.test.assertTrue

class ThemeContrastTest {
    @Test
    fun sourceTextAndSmallLabelsKeepReadableContrastInBothThemes() {
        for (scheme in listOf(LightColors, DarkColors)) {
            for ((foreground, background) in listOf(
                // Search rail navigation, retries and progress sit on the grey route background.
                scheme.onBackground to scheme.background,
                // Reader/catalog actions use the distinct opaque paper surface.
                scheme.primary to scheme.surface,
                scheme.onSurface to scheme.surface,
                scheme.onSurface to scheme.surfaceVariant,
                scheme.onSurfaceVariant to scheme.surfaceVariant,
                scheme.onSecondaryContainer to scheme.secondaryContainer,
                scheme.onPrimary to scheme.primary,
            )) {
                val low = luminance(foreground)
                val high = luminance(background)
                val ratio = (maxOf(low, high) + 0.05) / (minOf(low, high) + 0.05)
                assertTrue(ratio >= 4.5, "Small source text has contrast $ratio: $foreground / $background")
            }
        }
    }

    private fun luminance(color: Color): Double {
        fun linear(value: Float): Double =
            if (value <= 0.04045f) value / 12.92 else ((value + 0.055) / 1.055).pow(2.4)
        return 0.2126 * linear(color.red) + 0.7152 * linear(color.green) + 0.0722 * linear(color.blue)
    }
}
