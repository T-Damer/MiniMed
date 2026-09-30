package dev.localmed.nativespike.shared.designsystem.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.designsystem.NativeBottomNav
import dev.localmed.nativespike.shared.designsystem.NativeCardAction
import dev.localmed.nativespike.shared.designsystem.NativeChip
import dev.localmed.nativespike.shared.designsystem.NativeClinicalToggle
import dev.localmed.nativespike.shared.designsystem.NativeDesign
import dev.localmed.nativespike.shared.designsystem.NativeFeature
import dev.localmed.nativespike.shared.designsystem.NativeFeatureCarousel
import dev.localmed.nativespike.shared.designsystem.NativeIconButton
import dev.localmed.nativespike.shared.designsystem.NativeNavItem
import dev.localmed.nativespike.shared.designsystem.NativeQueryFooter
import dev.localmed.nativespike.shared.designsystem.NativeQueryInput
import dev.localmed.nativespike.shared.designsystem.NativeQueryProgress
import dev.localmed.nativespike.shared.designsystem.NativeQuerySheet
import dev.localmed.nativespike.shared.designsystem.NativeSectionList
import dev.localmed.nativespike.shared.designsystem.NativeSectionRow
import dev.localmed.nativespike.shared.designsystem.NativeSourcePicker
import dev.localmed.nativespike.shared.ui.NativeAppGlyph
import dev.localmed.nativespike.shared.ui.NativeAppGlyphName

/**
 * The home screen assembled only from design-system components, interactive, for review in the
 * Wasm preview (`?scene=design`) and for `native:design compare`. Developer tool, not a product
 * screen; it borrows the shared glyph set for its icon slots.
 */
@Composable
fun NativeDesignGallery(loading: Boolean = false, autoplay: Boolean = true) {
    val colors = NativeDesign.colors
    val components = NativeDesign.components
    var query by remember { mutableStateOf("") }
    var clinical by remember { mutableStateOf(false) }
    var page by remember { mutableIntStateOf(0) }
    val glyph = { name: NativeAppGlyphName, size: Int ->
        @Composable { tint: Color -> NativeAppGlyph(name, Modifier.size(size.dp), tint) }
    }
    val features = listOf(
        NativeFeature(
            kicker = "Фото ЭКГ",
            title = "ЭКГ по фото",
            text = "RR, ЧСС, PR, QRS, QT и QTc по снимку ленты. Разметку вы проверяете по шагам, фото не покидает устройство.",
            primary = NativeCardAction("Сфотографировать", {}, glyph(NativeAppGlyphName.Camera, 18)),
            secondary = NativeCardAction("Из галереи", {}, glyph(NativeAppGlyphName.Image, 18)),
            kickerIcon = glyph(NativeAppGlyphName.Heartbeat, 14),
            help = { NativeIconButton(components.helpIconLink, "help-icon-link", "Как это работает", {}, icon = glyph(NativeAppGlyphName.Question, 14)) },
        ),
        NativeFeature(
            kicker = "Приём",
            title = "Запись беседы",
            text = "Запишите разговор на приёме и прикрепите запись к карточке пациента. Запись хранится только на устройстве.",
            primary = NativeCardAction("Начать запись", {}, glyph(NativeAppGlyphName.Vibrate, 18)),
            secondary = NativeCardAction("Пациенты", {}, glyph(NativeAppGlyphName.Users, 18)),
            kickerIcon = glyph(NativeAppGlyphName.Vibrate, 14),
        ),
        NativeFeature(
            kicker = "Калькуляторы",
            title = "Шкалы и калькуляторы",
            text = "Расчёты с источниками и интерпретацией.",
            primary = NativeCardAction("Открыть", {}, glyph(NativeAppGlyphName.Calculator, 18)),
            kickerIcon = glyph(NativeAppGlyphName.Calculator, 14),
        ),
    )
    // A phone-width column centred on wide windows, as the WebView app on a desktop browser.
    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(colors.folderLight, colors.folder))), contentAlignment = Alignment.TopCenter) {
      Box(Modifier.widthIn(max = 430.dp).fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 10.dp, end = 10.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(Modifier.fillMaxWidth().padding(top = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                NativeIconButton(components.historyFab, "history-fab", "История", {}, icon = glyph(NativeAppGlyphName.History, 20))
                Spacer(Modifier.weight(1f))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    NativeIconButton(components.routeIconButton, "route-icon-button", "Случайная запись", {}, icon = glyph(NativeAppGlyphName.Dice, 20))
                    NativeIconButton(components.routeIconButton, "route-icon-button", "Карта связей", {}, icon = glyph(NativeAppGlyphName.Graph, 20))
                    NativeIconButton(components.routeIconButton, "route-icon-button", "Справка", {}, icon = glyph(NativeAppGlyphName.Question, 20))
                }
            }
            NativeQuerySheet {
                NativeQueryInput(query, { query = it }, "Название, код МКБ, препарат или фраза из документа", {})
                NativeQueryFooter(
                    progress = when {
                        loading && query.isNotBlank() -> NativeQueryProgress("Ищем…", "Запрос выполнится, как только база подключится")
                        loading -> NativeQueryProgress("Подключаем базу…", "Можно уже вводить запрос")
                        else -> null
                    },
                ) {
                    NativeSourcePicker("Все источники", {}, leadingIcon = glyph(NativeAppGlyphName.Books, 18), trailingIcon = glyph(NativeAppGlyphName.CaretDown, 14))
                    NativeClinicalToggle(clinical, { clinical = it }, "Клинический разбор", icon = { tint, on ->
                        NativeAppGlyph(if (on) NativeAppGlyphName.BrainFill else NativeAppGlyphName.Brain, Modifier.size(22.dp), tint)
                    })
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                NativeChip("Все инструменты", {}, icon = glyph(NativeAppGlyphName.Modules, 14))
            }
            NativeFeatureCarousel(
                features = features,
                positionLabel = { index, count -> "Функция ${index + 1} из $count" },
                previousLabel = "Предыдущая функция",
                nextLabel = "Следующая функция",
                autoplayMillis = if (autoplay) dev.localmed.nativespike.shared.designsystem.NATIVE_FEATURES_AUTOPLAY_MS else null,
            ) { tint, next -> NativeAppGlyph(if (next) NativeAppGlyphName.CaretRight else NativeAppGlyphName.CaretLeft, Modifier.size(14.dp), tint) }
            NativeSectionList("Разделы") {
                NativeSectionRow("МКБ, симптомы и состояния", "считаем…", true, {}, icon = glyph(NativeAppGlyphName.Notepad, 20), caret = glyph(NativeAppGlyphName.CaretRight, 16))
                NativeSectionRow("Клинические рекомендации", "считаем…", false, {}, icon = glyph(NativeAppGlyphName.BookOpen, 20), caret = glyph(NativeAppGlyphName.CaretRight, 16))
                NativeSectionRow("Препараты", "считаем…", false, {}, icon = glyph(NativeAppGlyphName.Prescription, 20), caret = glyph(NativeAppGlyphName.CaretRight, 16))
            }
        }
        NativeBottomNav(
            items = listOf(
                NativeNavItem("Поиск", glyph(NativeAppGlyphName.Search, 22)),
                NativeNavItem("Мои файлы", glyph(NativeAppGlyphName.FolderOpen, 22)),
                NativeNavItem("Настройки", glyph(NativeAppGlyphName.System, 22)),
            ),
            selected = page,
            onSelect = { page = it },
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp),
        )
      }
    }
}
