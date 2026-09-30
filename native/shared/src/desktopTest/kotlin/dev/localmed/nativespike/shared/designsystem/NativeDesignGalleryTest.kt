package dev.localmed.nativespike.shared.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toAwtImage
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import dev.localmed.nativespike.shared.ui.NativeAppGlyph
import dev.localmed.nativespike.shared.ui.NativeAppGlyphName
import java.io.File
import javax.imageio.ImageIO
import kotlin.test.Test

/** Writes the home composition built only from design-system components, for side-by-side review. */
@OptIn(ExperimentalTestApi::class)
class NativeDesignGalleryTest {
    @Test
    fun writeHomeGallery() {
        for ((dark, loading) in listOf(false to false, true to false, false to true)) {
            runComposeUiTest {
                setContent {
                    CompositionLocalProvider(LocalDensity provides Density(1f)) {
                        ProvideNativeDesignTokens(dark) { HomeGallery(loading) }
                    }
                }
                val name = (if (dark) "dark" else "light") + if (loading) "-loading" else ""
                val image = onRoot().captureToImage().toAwtImage()
                val out = File(System.getProperty("user.dir"), "../../playwright/native-design-gallery-$name.png")
                out.parentFile.mkdirs()
                ImageIO.write(image, "png", out)
            }
        }
    }
}

@androidx.compose.runtime.Composable
private fun HomeGallery(loading: Boolean) {
    val colors = NativeDesign.colors
    val components = NativeDesign.components
    val glyph = { name: NativeAppGlyphName, size: Int -> @androidx.compose.runtime.Composable { tint: Color -> NativeAppGlyph(name, Modifier.size(size.dp), tint) } }
    Box(Modifier.size(375.dp, 812.dp).background(Brush.verticalGradient(listOf(colors.folderLight, colors.folder)))) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 10.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth().padding(top = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                NativeIconButton(components.historyFab, "history-fab", "История", {}, icon = glyph(NativeAppGlyphName.History, 20))
                Spacer(Modifier.weight(1f))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    NativeIconButton(components.routeIconButton, "route-icon-button", "Случайная запись", {}, icon = glyph(NativeAppGlyphName.Notches, 20))
                    NativeIconButton(components.routeIconButton, "route-icon-button", "Карта связей", {}, icon = glyph(NativeAppGlyphName.Graph, 20))
                    NativeIconButton(components.routeIconButton, "route-icon-button", "Справка", {}, icon = glyph(NativeAppGlyphName.Question, 20))
                }
            }
            NativeQuerySheet {
                NativeQueryInput("", {}, "Название, код МКБ, препарат или фраза из документа", {})
                NativeQueryFooter(progress = if (loading) NativeQueryProgress("Подключаем базу…", "Поиск откроется через пару секунд") else null) {
                    NativeSourcePicker("Все источники", {}, leadingIcon = glyph(NativeAppGlyphName.Books, 18), trailingIcon = glyph(NativeAppGlyphName.CaretDown, 14))
                    NativeClinicalToggle(false, {}, "Клинический разбор", icon = { tint, _ -> NativeAppGlyph(NativeAppGlyphName.Brain, Modifier.size(22.dp), tint) })
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                NativeChip("Все инструменты", {}, icon = glyph(NativeAppGlyphName.Modules, 14))
            }
            NativeFeatureCard(
                kicker = "Фото ЭКГ",
                title = "ЭКГ по фото",
                text = "RR, ЧСС, PR, QRS, QT и QTc по снимку ленты. Разметку вы проверяете по шагам, фото не покидает устройство.",
                primary = NativeCardAction("Сфотографировать", {}, glyph(NativeAppGlyphName.Camera, 18)),
                secondary = NativeCardAction("Из галереи", {}, glyph(NativeAppGlyphName.Image, 18)),
                kickerIcon = glyph(NativeAppGlyphName.Heartbeat, 14),
                help = { NativeIconButton(components.helpIconLink, "help-icon-link", "Как это работает", {}, icon = glyph(NativeAppGlyphName.Question, 14)) },
            )
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                NativeCarouselDots(4, 0, {}, { "Функция ${it + 1} из 4" })
            }
            NativeSectionList("Разделы") {
                NativeSectionRow("МКБ, симптомы и состояния", "считаем…", true, {}, icon = glyph(NativeAppGlyphName.Notepad, 20), caret = glyph(NativeAppGlyphName.CaretRight, 16))
                NativeSectionRow("Клинические рекомендации", "считаем…", false, {}, icon = glyph(NativeAppGlyphName.BookOpen, 20), caret = glyph(NativeAppGlyphName.CaretRight, 16))
            }
        }
        NativeBottomNav(
            items = listOf(
                NativeNavItem("Поиск", glyph(NativeAppGlyphName.Search, 22)),
                NativeNavItem("Мои файлы", glyph(NativeAppGlyphName.FolderOpen, 22)),
                NativeNavItem("Настройки", glyph(NativeAppGlyphName.System, 22)),
            ),
            selected = 0,
            onSelect = {},
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp),
        )
    }
}
