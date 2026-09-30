package dev.localmed.nativespike.shared.designsystem.gallery

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import dev.localmed.nativespike.shared.designsystem.NativeDesign
import dev.localmed.nativespike.shared.designsystem.NativeDocumentActions
import dev.localmed.nativespike.shared.designsystem.NativeFindBar
import dev.localmed.nativespike.shared.designsystem.NativeFindIcons
import dev.localmed.nativespike.shared.designsystem.NativeOutlinePanel
import dev.localmed.nativespike.shared.designsystem.NativeReaderChromeState
import dev.localmed.nativespike.shared.designsystem.NativeReaderTool
import dev.localmed.nativespike.shared.designsystem.NativeReaderTopBar
import dev.localmed.nativespike.shared.designsystem.NativeReadingMenu
import dev.localmed.nativespike.shared.designsystem.NativeScrollTopButton
import dev.localmed.nativespike.shared.designsystem.blockIndexOf
import dev.localmed.nativespike.shared.designsystem.nativeDocumentItems
import dev.localmed.nativespike.shared.reader.NativeBlock
import dev.localmed.nativespike.shared.reader.NativeDocument
import dev.localmed.nativespike.shared.reader.NativeMarkdownImporter
import dev.localmed.nativespike.shared.reader.plainText
import dev.localmed.nativespike.shared.ui.NativeAppGlyph
import dev.localmed.nativespike.shared.ui.NativeAppGlyphName
import kotlinx.coroutines.launch

/**
 * The reader assembled from design-system parts over an imported Markdown sample: top bar that
 * hides on scroll down, outline drawer, find with hit navigation, text size. Developer tool
 * (`?scene=reader`), not a product screen.
 */
@Composable
fun NativeReaderGallery(markdown: String = SAMPLE_MARKDOWN, initialFind: String = "") {
    val colors = NativeDesign.colors
    val document = remember(markdown) { NativeMarkdownImporter.import(markdown) }
    val list = rememberLazyListState()
    val chrome = remember { NativeReaderChromeState() }
    val scope = rememberCoroutineScope()
    var textScale by remember { mutableIntStateOf(100) }
    var outlineOpen by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    var findOpen by remember { mutableStateOf(initialFind.isNotEmpty()) }
    var query by remember { mutableStateOf(initialFind) }
    var current by remember { mutableIntStateOf(0) }
    val hits = remember(document, query) { findHits(document, query) }
    val glyph = { name: NativeAppGlyphName, size: Int -> @Composable { tint: Color -> NativeAppGlyph(name, Modifier.size(size.dp), tint) } }
    val activeAnchor by remember(document) {
        derivedStateOf {
            document.blocks.take(list.firstVisibleItemIndex + 1).lastOrNull { it is NativeBlock.Heading }
                ?.let { (it as NativeBlock.Heading).anchor }
        }
    }
    fun jumpTo(block: Int) = scope.launch { list.animateScrollToItem(block.coerceAtLeast(0)) }
    fun showHit(index: Int) {
        if (hits.isEmpty()) return
        current = (index + hits.size) % hits.size
        jumpTo(hits[current].first)
    }
    val actions = NativeDocumentActions(
        textScale = textScale,
        onLink = { target -> if (target.startsWith("#")) jumpTo(document.blockIndexOf("md-" + target.drop(1))) },
        hits = { block -> hits.filter { it.first == block }.map { it.second } },
    )

    val paper = NativeDesign.components.readerPaper.background
    Box(Modifier.fillMaxSize().background(paper), contentAlignment = Alignment.TopCenter) {
        Box(Modifier.widthIn(max = 720.dp).fillMaxSize()) {
            LazyColumn(
                Modifier.fillMaxSize().nestedScroll(chrome.connection),
                state = list,
                contentPadding = PaddingValues(top = if (findOpen) 128.dp else 72.dp, bottom = 96.dp),
            ) { nativeDocumentItems(document, actions) }

            AnimatedVisibility(chrome.visible || findOpen, enter = slideInVertically { -it } + fadeIn(), exit = slideOutVertically { -it } + fadeOut()) {
                Column(
                    Modifier.fillMaxWidth().background(paper).drawBehind {
                        drawLine(colors.border, Offset(0f, size.height - 0.5f), Offset(size.width, size.height - 0.5f), 1.dp.toPx())
                    },
                ) {
                    NativeReaderTopBar("Пример документа Markdown", onBack = {}, backIcon = glyph(NativeAppGlyphName.ArrowLeft, 20)) {
                        NativeReaderTool("Разделы документа", { outlineOpen = true }, icon = glyph(NativeAppGlyphName.ListBullets, 20))
                        NativeReaderTool("Найти в документе", { findOpen = !findOpen }, active = findOpen, icon = glyph(NativeAppGlyphName.Search, 20))
                        NativeReaderTool("Настройки чтения", { menuOpen = !menuOpen }, active = menuOpen, icon = glyph(NativeAppGlyphName.TextAa, 20))
                    }
                    if (findOpen) {
                        NativeFindBar(
                            query = query,
                            onQueryChange = { query = it; current = 0; if (it.isNotBlank()) findHits(document, it).firstOrNull()?.let { hit -> jumpTo(hit.first) } },
                            current = current,
                            count = hits.size,
                            onPrevious = { showHit(current - 1) },
                            onNext = { showHit(current + 1) },
                            onClose = { findOpen = false; query = "" },
                            icons = NativeFindIcons(glyph(NativeAppGlyphName.CaretUp, 16), glyph(NativeAppGlyphName.CaretDown, 16), glyph(NativeAppGlyphName.Close, 16)),
                        )
                    }
                }
            }
            if (menuOpen) {
                NativeReadingMenu(textScale, { textScale = it }, Modifier.align(Alignment.TopEnd).padding(top = 64.dp, end = 12.dp))
            }
            val scrolled by remember { derivedStateOf { list.firstVisibleItemIndex > 2 } }
            AnimatedVisibility(scrolled, Modifier.align(Alignment.BottomEnd).padding(end = 12.dp, bottom = 24.dp), enter = fadeIn(), exit = fadeOut()) {
                NativeScrollTopButton({ jumpTo(0); chrome.show() }, icon = glyph(NativeAppGlyphName.ArrowUp, 20))
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

/** Every case-insensitive occurrence of [query] in the blocks' text, as (block index, range). */
private fun findHits(document: NativeDocument, query: String): List<Pair<Int, IntRange>> {
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

/** A formatting sample for the gallery: every block and inline type the importer produces. */
val SAMPLE_MARKDOWN = """
# Пример документа Markdown

Этот файл показывает, как читалка отображает **полужирный**, *курсив*, ~~зачёркнутый~~ и ==выделенный== текст, `моноширинный код` и формулы вроде ${'$'}E = mc^2${'$'}. Ссылки открываются по нажатию: [раздел «Таблицы»](#таблицы) или [внешний адрес](https://example.org).

## Списки

1. Первый пункт
2. Второй пункт со вложенным списком:
   - вложенный пункт
   - ещё один
3. Третий пункт

- [x] Выполненная задача
- [ ] Невыполненная задача

## Цитаты и примечания

> Обычная цитата выделяется полосой слева и приглушённым цветом.

> [!WARNING]
> Предупреждение GitHub показывается как отдельная плашка.

## Таблицы

| Столбец | Число | По центру |
| :--- | ---: | :---: |
| Первая строка | 12 | да |
| Вторая строка с длинным текстом, который переносится | 3,5 | нет |

## Код и формулы

```kotlin
fun main() {
    println("Привет")
}
```

${'$'}${'$'}
\int_0^1 x^2\,dx = \frac{1}{3}
${'$'}${'$'}

---

### Подраздел третьего уровня

Длинный абзац для проверки переноса строк и размера шрифта. Читалка сохраняет исходный текст целиком: импорт только раскладывает его по блокам и ничего не переписывает. Размер текста меняется в меню чтения от 90 до 140 процентов, поиск подсвечивает совпадения и переходит между ними.
""".trimIndent()
