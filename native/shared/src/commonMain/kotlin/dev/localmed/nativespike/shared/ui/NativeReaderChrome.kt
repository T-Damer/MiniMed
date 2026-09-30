package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import dev.localmed.nativespike.shared.core.NativeReaderTarget
import dev.localmed.nativespike.shared.designsystem.NativeDimensions
import dev.localmed.nativespike.shared.designsystem.NativeReaderChromeState
import dev.localmed.nativespike.shared.designsystem.NativeReaderGlyphs

/** Reader chrome visibility, shared with the shell so bottom navigation hides with the reader bar. */
typealias NativeReaderChrome = NativeReaderChromeState

internal val LocalNativeReaderChrome = compositionLocalOf<NativeReaderChrome?> { null }

@Composable
fun rememberNativeReaderChrome(target: NativeReaderTarget): NativeReaderChrome =
    LocalNativeReaderChrome.current ?: remember(target) { NativeReaderChrome() }

/** The app glyph set in the design-system reader's icon slots. */
internal fun nativeReaderAppGlyphs(): NativeReaderGlyphs {
    fun glyph(name: NativeAppGlyphName, small: Boolean = false): @Composable (Color) -> Unit = { tint ->
        NativeAppGlyph(name, Modifier.size(if (small) NativeDimensions.space4 else NativeDimensions.space5), tint)
    }
    return NativeReaderGlyphs(
        back = glyph(NativeAppGlyphName.ArrowLeft),
        outline = glyph(NativeAppGlyphName.ListBullets),
        find = glyph(NativeAppGlyphName.Search),
        settings = glyph(NativeAppGlyphName.TextAa),
        previous = glyph(NativeAppGlyphName.CaretUp, true),
        next = glyph(NativeAppGlyphName.CaretDown, true),
        close = glyph(NativeAppGlyphName.Close, true),
        top = glyph(NativeAppGlyphName.ArrowUp),
    )
}
