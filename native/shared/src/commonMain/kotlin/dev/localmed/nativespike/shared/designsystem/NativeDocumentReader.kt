package dev.localmed.nativespike.shared.designsystem

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateIntAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
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
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.reader.NativeBlock
import dev.localmed.nativespike.shared.reader.NativeDocument
import dev.localmed.nativespike.shared.reader.plainText
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Everything a document reader remembers: list position, chrome visibility, find, outline, text
 * size. Screens hoist it to sync their own chrome (bottom navigation follows [chrome]) and to save
 * the reading position from [list] and [currentBlock].
 */
@Stable
class NativeDocumentReaderState internal constructor(
    val document: NativeDocument,
    val list: LazyListState,
    val chrome: NativeReaderChromeState,
    /** Items the screen puts in the list before the blocks (a header, notices). */
    val itemsBefore: Int,
    private val scope: CoroutineScope,
    initialFind: String,
) {
    var textScale by mutableIntStateOf(100)
    var outlineOpen by mutableStateOf(false)
    var menuOpen by mutableStateOf(false)
    var findOpen by mutableStateOf(initialFind.isNotEmpty())
    var query by mutableStateOf(initialFind)
        private set
    var current by mutableIntStateOf(0)
        private set

    /** Height of the pinned section title, kept clear when jumping into a section. */
    var pinnedHeight by mutableIntStateOf(0)
        internal set

    /** Find hits as (block index, character range of the block's plain text). */
    val hits: List<Pair<Int, IntRange>> by derivedStateOf { nativeFindHits(document, query) }

    /** The block at the top of the view, or -1 while the screen's own items are there. */
    val currentBlock: Int by derivedStateOf { document.blockIndexAt(list.firstVisibleItemIndex, itemsBefore) }

    /** Anchor of the heading whose section is being read. */
    val activeAnchor: String? by derivedStateOf {
        document.blocks.take(currentBlock + 1).lastOrNull { it is NativeBlock.Heading }?.let { (it as NativeBlock.Heading).anchor }
    }

    fun jumpTo(block: Int) {
        if (block < 0) return
        // Inside a section the pinned title covers the top; a section title itself goes to the top.
        val title = (document.blocks.getOrNull(block) as? NativeBlock.Heading)?.level == 2
        scope.launch { list.animateScrollToItem(document.listIndexOf(block, itemsBefore), if (title) 0 else -pinnedHeight) }
    }

    /** Jumps to a heading by `#anchor`, trying the Markdown `md-` form too. False when absent. */
    fun jumpToAnchor(anchor: String): Boolean {
        val index = document.blockIndexOf(anchor).takeIf { it >= 0 } ?: document.blockIndexOf("md-$anchor")
        jumpTo(index)
        return index >= 0
    }

    fun find(value: String) {
        query = value
        current = 0
        hits.firstOrNull()?.let { jumpTo(it.first) }
    }

    fun showHit(index: Int) {
        if (hits.isEmpty()) return
        current = (index + hits.size) % hits.size
        jumpTo(hits[current].first)
    }

    fun closeFind() {
        findOpen = false
        query = ""
    }

    fun scrollToTop() {
        chrome.show()
        scope.launch { list.animateScrollToItem(0) }
    }
}

@Composable
fun rememberNativeDocumentReaderState(
    document: NativeDocument,
    itemsBefore: Int = 0,
    list: LazyListState = rememberLazyListState(),
    chrome: NativeReaderChromeState = remember { NativeReaderChromeState() },
    initialFind: String = "",
): NativeDocumentReaderState {
    val scope = rememberCoroutineScope()
    return remember(document, list, chrome, itemsBefore) { NativeDocumentReaderState(document, list, chrome, itemsBefore, scope, initialFind) }
}

/**
 * The reader bar: Back, the bounded title, the screen's [tools], then outline, find and reading
 * settings, with the find field under it while find is open. [background] is the reader paper;
 * a screen that draws its own backdrop behind the bar passes a transparent colour.
 */
@Composable
fun NativeDocumentReaderBar(
    state: NativeDocumentReaderState,
    title: String,
    onBack: () -> Unit,
    glyphs: NativeReaderGlyphs,
    modifier: Modifier = Modifier,
    background: Color = NativeDesign.components.readerPaper.background,
    tools: @Composable RowScope.() -> Unit = {},
) {
    val colors = NativeDesign.colors
    Column(
        modifier.fillMaxWidth().background(background).drawBehind {
            drawLine(colors.border, Offset(0f, size.height - 0.5f), Offset(size.width, size.height - 0.5f), 1.dp.toPx())
        },
    ) {
        NativeReaderTopBar(title, onBack = onBack, backIcon = glyphs.back) {
            tools()
            if (state.document.outline.isNotEmpty()) NativeReaderTool("Разделы документа", { state.outlineOpen = true }, icon = glyphs.outline)
            NativeReaderTool("Найти в документе", { if (state.findOpen) state.closeFind() else state.findOpen = true }, active = state.findOpen, icon = glyphs.find)
            NativeReaderTool("Настройки чтения", { state.menuOpen = !state.menuOpen }, active = state.menuOpen, icon = glyphs.settings)
        }
        if (state.findOpen) {
            NativeFindBar(
                query = state.query,
                onQueryChange = state::find,
                current = state.current,
                count = state.hits.size,
                onPrevious = { state.showHit(state.current - 1) },
                onNext = { state.showHit(state.current + 1) },
                onClose = state::closeFind,
                icons = NativeFindIcons(glyphs.previous, glyphs.next, glyphs.close),
            )
        }
    }
}

/**
 * The document as a lazy list that drives the chrome (scroll down hides it). [header] adds the
 * screen's own leading items; their count must equal [NativeDocumentReaderState.itemsBefore].
 * In-document links jump; other links go to [onExternalLink].
 */
@Composable
fun NativeDocumentReaderList(
    state: NativeDocumentReaderState,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(),
    onExternalLink: (String) -> Unit = nativeOpenExternalLink(),
    image: (@Composable (source: String, alt: String, modifier: Modifier) -> Unit)? = null,
    header: LazyListScope.() -> Unit = {},
) {
    val hits = state.hits
    val actions = NativeDocumentActions(
        textScale = state.textScale,
        onLink = { target -> if (!(target.startsWith("#") && state.jumpToAnchor(target.drop(1)))) onExternalLink(target) },
        image = image,
        hits = { block -> hits.filter { it.first == block }.map { it.second } },
    )
    LazyColumn(modifier.fillMaxSize().nestedScroll(state.chrome.connection), state = state.list, contentPadding = contentPadding) {
        header()
        nativeDocumentItems(state.document, actions)
    }
}

/**
 * Opens web and mail links in the system browser or mail app; the reader never loads them itself.
 * Other schemes (`javascript:`, `file:`, relative paths) do nothing.
 */
@Composable
fun nativeOpenExternalLink(): (String) -> Unit {
    val handler = LocalUriHandler.current
    return remember(handler) {
        { target ->
            val scheme = target.substringBefore(':', "").lowercase()
            if (scheme == "http" || scheme == "https" || scheme == "mailto") handler.openUri(target)
        }
    }
}

/**
 * What floats over the reading list: the current section title pinned at [top] (under the bar, or
 * under the status bar while the bar is hidden), the reading menu, the scroll-top button above
 * [bottom], and the outline drawer.
 */
@Composable
fun NativeDocumentReaderOverlays(state: NativeDocumentReaderState, glyphs: NativeReaderGlyphs, top: Dp, bottom: Dp = 0.dp) {
    Box(Modifier.fillMaxSize()) {
        PinnedSectionTitle(state, top)
        if (state.menuOpen) {
            NativeReadingMenu(state.textScale, { state.textScale = it }, Modifier.align(Alignment.TopEnd).padding(top = top + 8.dp, end = 12.dp))
        }
        val scrolled by remember(state) { derivedStateOf { state.list.firstVisibleItemIndex > 2 } }
        AnimatedVisibility(scrolled, Modifier.align(Alignment.BottomEnd).padding(end = 12.dp, bottom = bottom + 24.dp), enter = fadeIn(), exit = fadeOut()) {
            NativeScrollTopButton(state::scrollToTop, icon = glyphs.top)
        }
        if (state.outlineOpen) {
            Box(Modifier.fillMaxSize().background(Color(0x66000000)).clickable(remember { MutableInteractionSource() }, indication = null) { state.outlineOpen = false })
        }
        AnimatedVisibility(state.outlineOpen, enter = slideInHorizontally { -it }, exit = slideOutHorizontally { -it }) {
            NativeOutlinePanel(
                state.document.outline,
                state.activeAnchor,
                onSelect = { item ->
                    state.outlineOpen = false
                    state.jumpTo(state.document.blockIndexOf(item.anchor))
                },
                modifier = Modifier.fillMaxHeight().fillMaxWidth(0.82f).padding(top = top),
            )
        }
    }
}

/**
 * Web sticky section titles: the level-2 title of the section being read stays at [top]; the next
 * title pushes it up as it arrives. Drawn over the list because Compose sticky headers ignore the
 * list's top padding, and the text scrolls under the bar. A visual copy, hidden from accessibility.
 */
@Composable
private fun PinnedSectionTitle(state: NativeDocumentReaderState, top: Dp) {
    val density = LocalDensity.current
    val topPx = with(density) { top.roundToPx() }
    var height by remember { mutableIntStateOf(0) }
    val pinned by remember(state, topPx) {
        derivedStateOf {
            val document = state.document
            val info = state.list.layoutInfo
            // Item offsets count from the content start; the list's top padding puts them lower.
            val shift = -info.viewportStartOffset
            val items = info.visibleItemsInfo.map { it.index to it.offset + shift }
            fun titleAt(listIndex: Int): Int? = document.blockIndexAt(listIndex, state.itemsBefore)
                .takeIf { it >= 0 && (document.blocks[it] as? NativeBlock.Heading)?.level == 2 }
            val passed = items.filter { (_, y) -> y < topPx }.mapNotNull { (index, _) -> titleAt(index) }.lastOrNull()
            // The block crossing the line (or the first one below it) belongs to the section being read.
            val line = (items.lastOrNull { (_, y) -> y < topPx } ?: items.firstOrNull())?.let { (index, _) -> document.blockIndexAt(index, state.itemsBefore) } ?: -1
            // The section's own title, while still on screen below the line, needs no copy.
            val current = passed ?: (line downTo 0).firstOrNull { (document.blocks[it] as? NativeBlock.Heading)?.level == 2 }
                ?.takeIf { title -> items.none { (index, _) -> titleAt(index) == title } }
            if (current == null) {
                null
            } else {
                val next = items.firstOrNull { (index, y) -> y >= topPx && titleAt(index)?.let { title -> title > current } == true }
                current to (next?.let { (_, y) -> minOf(0, y - topPx - height) } ?: 0)
            }
        }
    }
    val (block, push) = pinned ?: return
    val heading = state.document.blocks[block] as NativeBlock.Heading
    Box(
        Modifier
            .fillMaxWidth()
            .offset { IntOffset(0, topPx + push) }
            .onSizeChanged {
                height = it.height
                state.pinnedHeight = it.height
            }
            .testTag("reader-pinned-title")
            .clearAndSetSemantics {},
    ) {
        NativeDocumentBlock(heading, NativeDocumentActions(textScale = state.textScale), block)
    }
}

/**
 * A complete document reader for screens without their own chrome scaffold: an opaque paper bar
 * that slides away on scroll down and back on scroll up while the text stays in place, the status
 * area in [windowInsets] kept painted, pinned section titles, outline, find, text size and the
 * scroll-top button. Icons are slots.
 */
@Composable
fun NativeDocumentReader(
    title: String,
    document: NativeDocument,
    onBack: () -> Unit,
    glyphs: NativeReaderGlyphs,
    modifier: Modifier = Modifier,
    state: NativeDocumentReaderState = rememberNativeDocumentReaderState(document),
    windowInsets: WindowInsets = WindowInsets(0),
    onExternalLink: (String) -> Unit = nativeOpenExternalLink(),
    image: (@Composable (source: String, alt: String, modifier: Modifier) -> Unit)? = null,
    tools: @Composable RowScope.() -> Unit = {},
) {
    val density = LocalDensity.current
    val paper = NativeDesign.components.readerPaper.background
    val insets = windowInsets.asPaddingValues()
    val statusTop = insets.calculateTopPadding()
    var barHeight by remember { mutableIntStateOf(0) }
    val shown = state.chrome.visible || state.findOpen
    val barOffset by animateIntAsState(if (shown) 0 else -barHeight, label = "reader-bar")
    val barBottom = with(density) { statusTop + (barHeight + barOffset).coerceAtLeast(0).toDp() }
    Box(modifier.fillMaxSize().background(paper), contentAlignment = Alignment.TopCenter) {
        Box(Modifier.widthIn(max = 720.dp).fillMaxSize()) {
            NativeDocumentReaderList(
                state,
                contentPadding = PaddingValues(
                    top = statusTop + with(density) { barHeight.toDp() } + 16.dp,
                    bottom = insets.calculateBottomPadding() + 96.dp,
                ),
                onExternalLink = onExternalLink,
                image = image,
            )
            NativeDocumentReaderOverlays(state, glyphs, top = barBottom, bottom = insets.calculateBottomPadding())
            NativeDocumentReaderBar(
                state,
                title,
                onBack,
                glyphs,
                Modifier.padding(top = statusTop).offset { IntOffset(0, barOffset) }.onSizeChanged { barHeight = it.height },
                tools = tools,
            )
            // The status area stays paper while the bar is away, as the WebView reader keeps it.
            Box(Modifier.fillMaxWidth().height(statusTop).background(paper))
        }
    }
}

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

/** Icon slots of the reader; the design system has no glyph set of its own. */
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
