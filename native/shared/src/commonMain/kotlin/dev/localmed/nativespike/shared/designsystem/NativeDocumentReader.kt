package dev.localmed.nativespike.shared.designsystem

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.expandVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.reader.NativeBlock
import dev.localmed.nativespike.shared.reader.NativeDocument
import dev.localmed.nativespike.shared.reader.plainText
import kotlinx.coroutines.launch

/**
 * A document reader built from design-system parts: a top bar that hides on scroll down and
 * returns on scroll up, the outline drawer, find with hit navigation, text size and the scroll-top
 * button. In-document links (`#anchor`) jump; other links go to [onExternalLink]. Icons are slots.
 */
@Composable
fun NativeDocumentReader(
    title: String,
    document: NativeDocument,
    onBack: () -> Unit,
    glyphs: NativeReaderGlyphs,
    modifier: Modifier = Modifier,
    onExternalLink: (String) -> Unit = {},
    image: (@Composable (source: String, alt: String, modifier: Modifier) -> Unit)? = null,
    initialFind: String = "",
    tools: @Composable RowScope.() -> Unit = {},
) {
    val colors = NativeDesign.colors
    val list = rememberLazyListState()
    val chrome = remember { NativeReaderChromeState() }
    val scope = rememberCoroutineScope()
    var textScale by remember { mutableIntStateOf(100) }
    var outlineOpen by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    var findOpen by remember { mutableStateOf(initialFind.isNotEmpty()) }
    var query by remember { mutableStateOf(initialFind) }
    var current by remember { mutableIntStateOf(0) }
    val hits = remember(document, query) { nativeFindHits(document, query) }
    val activeAnchor by remember(document) {
        derivedStateOf {
            document.blocks.take(document.blockIndexAt(list.firstVisibleItemIndex) + 1).lastOrNull { it is NativeBlock.Heading }
                ?.let { (it as NativeBlock.Heading).anchor }
        }
    }
    fun jumpTo(block: Int) = scope.launch { list.animateScrollToItem(document.listIndexOf(block.coerceAtLeast(0))) }
    fun showHit(index: Int) {
        if (hits.isEmpty()) return
        current = (index + hits.size) % hits.size
        jumpTo(hits[current].first)
    }
    val actions = NativeDocumentActions(
        textScale = textScale,
        onLink = { target ->
            if (target.startsWith("#")) {
                val anchor = target.drop(1)
                val index = document.blockIndexOf(anchor).takeIf { it >= 0 } ?: document.blockIndexOf("md-$anchor")
                if (index >= 0) jumpTo(index)
            } else {
                onExternalLink(target)
            }
        },
        image = image,
        hits = { block -> hits.filter { it.first == block }.map { it.second } },
    )

    val paper = NativeDesign.components.readerPaper.background
    Box(modifier.fillMaxSize().background(paper), contentAlignment = Alignment.TopCenter) {
        Box(Modifier.widthIn(max = 720.dp).fillMaxSize()) {
            // The bar sits above the list rather than over it, so sticky section titles stop
            // under it; it folds away on scroll down and returns on scroll up.
            Column(Modifier.fillMaxSize()) {
                AnimatedVisibility(chrome.visible || findOpen, enter = expandVertically(expandFrom = Alignment.Top) + fadeIn(), exit = shrinkVertically(shrinkTowards = Alignment.Top) + fadeOut()) {
                    Column(
                        Modifier.fillMaxWidth().background(paper).drawBehind {
                            drawLine(colors.border, Offset(0f, size.height - 0.5f), Offset(size.width, size.height - 0.5f), 1.dp.toPx())
                        },
                    ) {
                        NativeReaderTopBar(title, onBack = onBack, backIcon = glyphs.back) {
                            tools()
                            if (document.outline.isNotEmpty()) NativeReaderTool("Разделы документа", { outlineOpen = true }, icon = glyphs.outline)
                            NativeReaderTool("Найти в документе", { findOpen = !findOpen }, active = findOpen, icon = glyphs.find)
                            NativeReaderTool("Настройки чтения", { menuOpen = !menuOpen }, active = menuOpen, icon = glyphs.settings)
                        }
                        if (findOpen) {
                            NativeFindBar(
                                query = query,
                                onQueryChange = { query = it; current = 0; if (it.isNotBlank()) nativeFindHits(document, it).firstOrNull()?.let { hit -> jumpTo(hit.first) } },
                                current = current,
                                count = hits.size,
                                onPrevious = { showHit(current - 1) },
                                onNext = { showHit(current + 1) },
                                onClose = { findOpen = false; query = "" },
                                icons = NativeFindIcons(glyphs.previous, glyphs.next, glyphs.close),
                            )
                        }
                    }
                }
                LazyColumn(
                    Modifier.fillMaxWidth().weight(1f).nestedScroll(chrome.connection),
                    state = list,
                    contentPadding = PaddingValues(top = 16.dp, bottom = 96.dp),
                ) { nativeDocumentItems(document, actions) }
            }
            if (menuOpen) {
                NativeReadingMenu(textScale, { textScale = it }, Modifier.align(Alignment.TopEnd).padding(top = 64.dp, end = 12.dp))
            }
            val scrolled by remember { derivedStateOf { list.firstVisibleItemIndex > 2 } }
            AnimatedVisibility(scrolled, Modifier.align(Alignment.BottomEnd).padding(end = 12.dp, bottom = 24.dp), enter = fadeIn(), exit = fadeOut()) {
                NativeScrollTopButton({ jumpTo(0); chrome.show() }, icon = glyphs.top)
            }
            if (outlineOpen) {
                Box(
                    Modifier.fillMaxSize().background(Color(0x66000000))
                        .clickable(remember { MutableInteractionSource() }, indication = null) { outlineOpen = false },
                )
            }
            AnimatedVisibility(outlineOpen, enter = slideInHorizontally { -it }, exit = slideOutHorizontally { -it }) {
                NativeOutlinePanel(
                    document.outline,
                    activeAnchor,
                    onSelect = { item ->
                        outlineOpen = false
                        jumpTo(document.blockIndexOf(item.anchor))
                    },
                    modifier = Modifier.fillMaxHeight().fillMaxWidth(0.82f),
                )
            }
        }
    }
}

/** Icon slots of [NativeDocumentReader]; the design system has no glyph set of its own. */
data class NativeReaderGlyphs(
    val back: @Composable (tint: Color) -> Unit,
    val outline: @Composable (tint: Color) -> Unit,
    val find: @Composable (tint: Color) -> Unit,
    val settings: @Composable (tint: Color) -> Unit,
    val previous: @Composable (tint: Color) -> Unit,
    val next: @Composable (tint: Color) -> Unit,
    val close: @Composable (tint: Color) -> Unit,
    val top: @Composable (tint: Color) -> Unit,
)

/** Every case-insensitive occurrence of [query] in the blocks' text, as (block index, range). */
fun nativeFindHits(document: NativeDocument, query: String): List<Pair<Int, IntRange>> {
    val needle = query.trim()
    if (needle.isEmpty()) return emptyList()
    val hits = mutableListOf<Pair<Int, IntRange>>()
    document.blocks.forEachIndexed { index, block ->
        val text = block.plainText()
        var from = text.indexOf(needle, ignoreCase = true)
        while (from >= 0) {
            hits += index to (from until from + needle.length)
            from = text.indexOf(needle, from + needle.length, ignoreCase = true)
        }
    }
    return hits
}

