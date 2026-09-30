package dev.localmed.nativespike.shared.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.reader.NativeOutlineItem

/**
 * Reader chrome visibility: scrolling down hides the controls, scrolling up shows them
 * (docs/NATIVE_STICKY_CHROME.md). Attach [connection] to the reading list's `nestedScroll`.
 */
@Stable
class NativeReaderChromeState {
    var visible by mutableStateOf(true)
        private set

    val connection = object : NestedScrollConnection {
        override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
            // Programmatic scrolls (restoring a position, jumping to a heading) keep the state.
            if (source == NestedScrollSource.UserInput && available.y != 0f) visible = available.y > 0f
            return Offset.Zero
        }
    }

    fun show() {
        visible = true
    }
}

/**
 * The reader's one-row top bar (native decision in docs/NATIVE_STICKY_CHROME.md): a primary Back
 * button, the bounded document title, then the reader's tools. Geometry and paper come from the
 * web `.document-page__chrome`; the screen adds the status-bar inset and backdrop around it.
 */
@Composable
fun NativeReaderTopBar(
    title: String,
    onBack: () -> Unit,
    backIcon: @Composable (tint: Color) -> Unit,
    modifier: Modifier = Modifier,
    backLabel: String = "Назад",
    tools: @Composable RowScope.() -> Unit = {},
) {
    val components = NativeDesign.components
    val colors = NativeDesign.colors
    val bar = components.readerChrome
    Row(
        modifier.fillMaxWidth().testTag("reader-chrome").nativePadding(bar),
        horizontalArrangement = Arrangement.spacedBy(bar.columnGap.coerceAtLeast(NativeDimensions.space2)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val back = components.readerBack.copy(background = colors.accent, borderColor = colors.accent)
        NativeIconButton(back, "reader-back", backLabel, onBack) { backIcon(colors.accentContrast) }
        BasicText(
            title,
            Modifier.weight(1f).semantics { heading() },
            style = components.readerCrumbCurrent.text.textStyle(),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        tools()
    }
}

/** A round tool in the reader bar (outline, find, reading settings): web `.document-find__toggle`. */
@Composable
fun NativeReaderTool(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, active: Boolean = false, icon: @Composable (tint: Color) -> Unit) {
    val components = NativeDesign.components
    val colors = NativeDesign.colors
    val style = if (active) components.readerFindToggle.copy(background = colors.accentSoft, borderColor = colors.accent) else components.readerFindToggle
    NativeIconButton(style, "reader-tool", label, onClick, modifier) { icon(if (active) colors.accent else colors.text) }
}

/** Web `.scroll-top-button`: the dark round «to the top» button over the page corner. */
@Composable
fun NativeScrollTopButton(onClick: () -> Unit, modifier: Modifier = Modifier, label: String = "Наверх", icon: @Composable (tint: Color) -> Unit) {
    NativeIconButton(NativeDesign.components.scrollTopButton, "scroll-top-button", label, onClick, modifier, icon = icon)
}

/**
 * Find in the document: a query field, «3 из 12» and previous/next. Hits are the screen's to
 * compute (it knows the document) and to show through [NativeDocumentActions.hits].
 */
@Composable
fun NativeFindBar(
    query: String,
    onQueryChange: (String) -> Unit,
    current: Int,
    count: Int,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onClose: () -> Unit,
    icons: NativeFindIcons,
    modifier: Modifier = Modifier,
) {
    val components = NativeDesign.components
    val colors = NativeDesign.colors
    val shape = RoundedCornerShape(NativeDimensions.radiusControl)
    Row(
        modifier.fillMaxWidth().testTag("reader-find").padding(horizontal = 16.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(NativeDimensions.space2),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.weight(1f).heightIn(min = 41.6.dp).background(colors.surfaceRaised, shape).border(1.dp, colors.border, shape).padding(horizontal = 12.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            val text = components.readerParagraph.text.textStyle()
            if (query.isEmpty()) BasicText("Найти в документе", style = text.copy(color = colors.textFaint))
            BasicTextField(
                query,
                onQueryChange,
                Modifier.fillMaxWidth(),
                singleLine = true,
                textStyle = text,
                cursorBrush = SolidColor(colors.accent),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { onNext() }),
            )
        }
        val status = when {
            query.isBlank() -> ""
            count == 0 -> "нет"
            else -> "${current + 1} из $count"
        }
        BasicText(
            status,
            Modifier.widthIn(min = 44.dp).semantics { liveRegion = LiveRegionMode.Polite },
            style = components.resultPath.text.textStyle().copy(color = if (count == 0 && query.isNotBlank()) colors.danger else colors.textMuted),
        )
        NativeReaderTool("Предыдущее совпадение", onPrevious, icon = icons.previous)
        NativeReaderTool("Следующее совпадение", onNext, icon = icons.next)
        NativeReaderTool("Закрыть поиск", onClose, icon = icons.close)
    }
}

/** Icon slots of [NativeFindBar]. */
data class NativeFindIcons(
    val previous: @Composable (tint: Color) -> Unit,
    val next: @Composable (tint: Color) -> Unit,
    val close: @Composable (tint: Color) -> Unit,
)

/**
 * The document outline as a paper panel: headings indented by level, the current section marked,
 * a tap jumps to the heading (web `.document-overlay-outline`).
 */
@Composable
fun NativeOutlinePanel(items: List<NativeOutlineItem>, active: String?, onSelect: (NativeOutlineItem) -> Unit, modifier: Modifier = Modifier, title: String = "Разделы документа") {
    val components = NativeDesign.components
    val colors = NativeDesign.colors
    val topDepth = items.minOfOrNull { it.depth } ?: 1
    Column(modifier.testTag("reader-outline").background(colors.paper).verticalScroll(rememberScrollState()).padding(vertical = 12.dp)) {
        BasicText(
            title,
            Modifier.padding(horizontal = 18.dp, vertical = 8.dp).semantics { heading() },
            style = components.featureKicker.text.textStyle(),
        )
        if (items.isEmpty()) {
            BasicText("В документе нет заголовков", Modifier.padding(horizontal = 18.dp, vertical = 8.dp), style = components.sectionCount.text.textStyle())
        }
        for (item in items) {
            val selected = item.anchor == active
            BasicText(
                item.label,
                Modifier
                    .fillMaxWidth()
                    .selectable(selected, role = Role.Tab) { onSelect(item) }
                    .background(if (selected) colors.accentSoft else Color.Transparent)
                    .drawBehind { if (selected) drawRect(colors.accent, size = size.copy(width = 3.dp.toPx())) }
                    .padding(start = 18.dp + 14.dp * (item.depth - topDepth), end = 18.dp, top = 9.dp, bottom = 9.dp),
                style = components.sectionName.text.textStyle().copy(
                    fontWeight = if (item.depth == topDepth) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (selected) colors.accent else colors.text,
                ),
            )
        }
    }
}

/**
 * Reading settings: text size steps as the web reader (90–140 %). A floating paper card; the screen
 * decides where it appears.
 */
@Composable
fun NativeReadingMenu(textScale: Int, onTextScale: (Int) -> Unit, modifier: Modifier = Modifier) {
    val components = NativeDesign.components
    val colors = NativeDesign.colors
    val shape = RoundedCornerShape(NativeDimensions.radiusPanel)
    Column(
        modifier
            .testTag("reader-menu")
            .widthIn(max = 320.dp)
            .dropShadow(shape, NativeDesign.shadows.controlHoverShadow.first().toShadow())
            .background(colors.surfaceRaised, shape)
            .border(1.dp, colors.border, shape)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        BasicText("Размер текста", style = components.featureKicker.text.textStyle())
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for (step in NATIVE_READER_TEXT_SCALES) {
                val selected = step == textScale
                val chip = RoundedCornerShape(50)
                BasicText(
                    "$step %",
                    Modifier
                        .selectable(selected, role = Role.RadioButton) { onTextScale(step) }
                        .background(if (selected) colors.accent else colors.surface, chip)
                        .border(1.dp, if (selected) colors.accent else colors.border, chip)
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                    style = components.resultPath.text.textStyle().copy(color = if (selected) colors.accentContrast else colors.text),
                )
            }
        }
    }
}

/** Step to the next text scale in [direction] (−1 smaller, +1 larger), clamped at the ends. */
fun nativeStepTextScale(current: Int, direction: Int): Int {
    val index = NATIVE_READER_TEXT_SCALES.indexOf(current).takeIf { it >= 0 } ?: NATIVE_READER_TEXT_SCALES.indexOf(100)
    return NATIVE_READER_TEXT_SCALES[(index + direction).coerceIn(0, NATIVE_READER_TEXT_SCALES.lastIndex)]
}
