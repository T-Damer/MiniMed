package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import dev.localmed.nativespike.shared.designsystem.NativeDesign
import dev.localmed.nativespike.shared.designsystem.NativeDimensions
import dev.localmed.nativespike.shared.designsystem.NativeFileReader
import dev.localmed.nativespike.shared.designsystem.NativeReaderGlyphs
import dev.localmed.nativespike.shared.designsystem.NativeReaderTool
import dev.localmed.nativespike.shared.reader.NativeReaderContent

internal val LocalNativeOpenFile = compositionLocalOf<(() -> Unit)?> { null }

@Composable
internal fun NativeOpenFileButton() {
    LocalNativeOpenFile.current?.let { open ->
        NativeReaderTool("Открыть файл", open, Modifier.testTag("user-library-page__open-file")) { tint ->
            NativeAppGlyph(NativeAppGlyphName.FolderOpen, Modifier.size(NativeDimensions.space5), tint)
        }
    }
}

@Composable
internal fun NativeOpenedFileScreen(content: NativeReaderContent, onBack: () -> Unit) {
    val glyphs = remember { nativeAppReaderGlyphs() }
    NativeFileReader(content, onBack, glyphs,
        Modifier.fillMaxSize().background(NativeDesign.components.readerPaper.background)
            .windowInsetsPadding(WindowInsets.safeDrawing),
        tools = { NativeOpenFileButton() })
}

private fun nativeAppReaderGlyphs(): NativeReaderGlyphs {
    fun glyph(name: NativeAppGlyphName, small: Boolean = false): @Composable (Color) -> Unit = { tint ->
        NativeAppGlyph(name, Modifier.size(if (small) NativeDimensions.space4 else NativeDimensions.space5), tint)
    }
    return NativeReaderGlyphs(glyph(NativeAppGlyphName.ArrowLeft), glyph(NativeAppGlyphName.ListBullets),
        glyph(NativeAppGlyphName.Search), glyph(NativeAppGlyphName.TextAa), glyph(NativeAppGlyphName.CaretUp, true),
        glyph(NativeAppGlyphName.CaretDown, true), glyph(NativeAppGlyphName.Close, true), glyph(NativeAppGlyphName.ArrowUp))
}
