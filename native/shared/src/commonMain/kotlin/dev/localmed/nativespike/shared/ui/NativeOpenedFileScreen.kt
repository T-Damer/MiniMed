package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.background
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.Dp
import dev.localmed.nativespike.shared.designsystem.NativeDesign
import dev.localmed.nativespike.shared.designsystem.NativeDimensions
import dev.localmed.nativespike.shared.designsystem.NativeDataImage
import dev.localmed.nativespike.shared.designsystem.NativeDocumentReaderBar
import dev.localmed.nativespike.shared.designsystem.NativeDocumentReaderList
import dev.localmed.nativespike.shared.designsystem.NativeDocumentReaderOverlays
import dev.localmed.nativespike.shared.designsystem.NativeFileReader
import dev.localmed.nativespike.shared.designsystem.NativeReaderTool
import dev.localmed.nativespike.shared.designsystem.rememberNativeDocumentReaderState
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
    val glyphs = remember { nativeReaderAppGlyphs() }
    if (content is NativeReaderContent.Document) {
        val chrome = LocalNativeReaderChrome.current ?: remember(content) { NativeReaderChrome() }
        val list = remember(content) { LazyListState() }
        val state = rememberNativeDocumentReaderState(content.document, list = list, chrome = chrome)
        var listTop by remember(content) { mutableStateOf<Dp?>(null) }
        NativeChromeScaffold(
            containerColor = NativeDesign.components.readerPaper.background,
            topBar = {
                Column(Modifier.fillMaxWidth()) {
                    Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
                    AnimatedVisibility(chrome.visible || state.findOpen,
                        enter = expandVertically(expandFrom = Alignment.Top) + fadeIn(),
                        exit = shrinkVertically(shrinkTowards = Alignment.Top) + fadeOut()) {
                        NativeDocumentReaderBar(state, content.title, onBack, glyphs,
                            modifier = Modifier.testTag("document-page__chrome"), background = Color.Transparent) {
                            NativeOpenFileButton()
                        }
                    }
                }
            },
        ) { padding ->
            val top = padding.calculateTopPadding()
            val paddedTop = maxOf(listTop ?: top, top)
            SideEffect { listTop = paddedTop }
            val bottom = padding.calculateBottomPadding() + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
            Box(Modifier.fillMaxSize()) {
                NativeDocumentReaderList(state,
                    modifier = Modifier.testTag("document-page__body"),
                    contentPadding = PaddingValues(top = paddedTop + NativeDimensions.space3, bottom = bottom + NativeDimensions.space3),
                    image = { source, alt, modifier -> NativeDataImage(source, alt, modifier) })
                NativeDocumentReaderOverlays(state, glyphs, top = top, bottom = bottom)
            }
        }
        return
    }
    val frame = Modifier.fillMaxSize().background(NativeDesign.components.readerPaper.background)
    // ponytail: PDF/notices do not consume reader insets yet; remove this fallback when they do.
    val viewport = frame.windowInsetsPadding(WindowInsets.safeDrawing)
    NativeFileReader(content, onBack, glyphs,
        viewport,
        windowInsets = WindowInsets.safeDrawing,
        tools = { NativeOpenFileButton() })
}
