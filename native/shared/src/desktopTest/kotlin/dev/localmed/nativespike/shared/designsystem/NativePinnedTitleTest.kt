package dev.localmed.nativespike.shared.designsystem

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.designsystem.gallery.nativeGalleryReaderGlyphs
import dev.localmed.nativespike.shared.reader.NativeBlock
import dev.localmed.nativespike.shared.reader.NativeMarkdownImporter
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@OptIn(ExperimentalTestApi::class)
class NativePinnedTitleTest {
    private val markdown = buildString {
        for (section in listOf("Первый", "Второй", "Третий")) {
            append("## $section\n\n")
            repeat(12) { append("Абзац $it раздела $section, достаточно длинный, чтобы занять пару строк на узком экране.\n\n") }
        }
    }

    @Test
    fun theSectionBeingReadStaysPinnedUntilTheNextTitleArrives() = runComposeUiTest {
        val document = NativeMarkdownImporter.import(markdown)
        lateinit var state: NativeDocumentReaderState
        setContent {
            ProvideNativeDesignTokens(dark = false) {
                state = rememberNativeDocumentReaderState(document)
                Box(Modifier.size(360.dp, 640.dp)) { NativeDocumentReader("Документ", document, {}, nativeGalleryReaderGlyphs(), state = state) }
            }
        }
        val second = document.blocks.indexOfFirst { it is NativeBlock.Heading && it.anchor == "md-второй" }
        fun pinned() = onAllNodesWithTag("reader-pinned-title", useUnmergedTree = true).fetchSemanticsNodes()
        // At the top of the first section its own title is on screen: no copy.
        assertEquals(0, pinned().size)
        for (step in 1..40) {
            runOnIdle { runBlocking<Unit> { state.list.scrollBy(120f) } }
            waitForIdle()
            val block = state.currentBlock
            val title = document.blocks.take(block + 1).lastOrNull { it is NativeBlock.Heading } as? NativeBlock.Heading
            val onScreen = title != null && state.list.layoutInfo.visibleItemsInfo.any { it.index == document.blocks.indexOf<NativeBlock>(title) }
            if (title != null && !onScreen) assertTrue(pinned().isNotEmpty(), "step $step: «${title.anchor}» not pinned at block $block")
        }
        assertTrue(second > 0)
    }
}
