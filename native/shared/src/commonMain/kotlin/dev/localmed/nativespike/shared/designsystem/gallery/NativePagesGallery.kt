package dev.localmed.nativespike.shared.designsystem.gallery

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.designsystem.NativeBreadcrumbs
import dev.localmed.nativespike.shared.designsystem.NativeChoice
import dev.localmed.nativespike.shared.designsystem.NativeChoiceGroup
import dev.localmed.nativespike.shared.designsystem.NativeCrumb
import dev.localmed.nativespike.shared.designsystem.NativeDesign
import dev.localmed.nativespike.shared.designsystem.NativeFeatureTile
import dev.localmed.nativespike.shared.designsystem.NativeFolderCard
import dev.localmed.nativespike.shared.designsystem.NativeGroupTitle
import dev.localmed.nativespike.shared.designsystem.NativeIconButton
import dev.localmed.nativespike.shared.designsystem.NativeIconToggle
import dev.localmed.nativespike.shared.designsystem.NativePageHeader
import dev.localmed.nativespike.shared.designsystem.NativePaperSheet
import dev.localmed.nativespike.shared.designsystem.NativePrimaryButton
import dev.localmed.nativespike.shared.designsystem.NativeRangeSetting
import dev.localmed.nativespike.shared.designsystem.NativeSearchField
import dev.localmed.nativespike.shared.designsystem.NativeSecondaryButton
import dev.localmed.nativespike.shared.designsystem.NativeSectionHeading
import dev.localmed.nativespike.shared.designsystem.NativeSettingSwitch
import dev.localmed.nativespike.shared.designsystem.NativeTextLink
import dev.localmed.nativespike.shared.ui.NativeAppGlyph
import dev.localmed.nativespike.shared.ui.NativeAppGlyphName

private fun glyph(name: NativeAppGlyphName, size: Int = 20): @Composable (Color) -> Unit = { tint -> NativeAppGlyph(name, Modifier.size(size.dp), tint) }

/**
 * The WebView settings page rebuilt from design-system parts, with its real copy, for side-by-side
 * review (`?scene=design-settings`). Developer tool, not the product screen.
 */
@Composable
fun NativeSettingsGallery() {
    var tabs by remember { mutableStateOf(false) }
    var vibration by remember { mutableStateOf(true) }
    var windows by remember { mutableStateOf(false) }
    var drafts by remember { mutableStateOf(true) }
    var updates by remember { mutableStateOf(true) }
    var volume by remember { mutableFloatStateOf(0.2f) }
    var speech by remember { mutableIntStateOf(0) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 10.dp, end = 10.dp, top = 26.dp, bottom = 96.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        NativePageHeader("Настройки", description = "Внешний вид, загрузки и дополнительные возможности.", icon = glyph(NativeAppGlyphName.System, 22))
        NativePaperSheet {
            NativeSectionHeading("Обновление приложения", description = "Установлена версия 0.6.45.", icon = glyph(NativeAppGlyphName.Refresh))
            Row { NativeSecondaryButton("Проверить обновления", {}) }
        }
        NativeGroupTitle("Основное")
        NativePaperSheet {
            NativeSettingSwitch("Отдельные вкладки разделов", tabs, { tabs = it }, helper = "Показывать базу знаний, опросники, калькуляторы и заметки отдельными кнопками внизу экрана.", icon = glyph(NativeAppGlyphName.SquaresFour))
            NativeSettingSwitch("Вибрация", vibration, { vibration = it }, helper = "Лёгкий отклик телефона при нажатиях.", icon = glyph(NativeAppGlyphName.Vibrate))
            NativeSettingSwitch("Плавающие окна", windows, { windows = it }, helper = "Открывать документы и калькуляторы в маленьком окне поверх текущего экрана.", icon = glyph(NativeAppGlyphName.FrameCorners))
            NativeSettingSwitch("Предварительные материалы", drafts, { drafts = it }, helper = "Показывать черновые наборы препаратов, калькуляторов, опросников и словарь терминов. Они могут быть неполными и ещё меняться.", icon = glyph(NativeAppGlyphName.Flask))
            NativeSettingSwitch("Обновлять материалы автоматически", updates, { updates = it }, helper = "Новые версии уже скачанных наборов загружаются сами.", icon = glyph(NativeAppGlyphName.Refresh))
            NativeRangeSetting("Звуки", volume, { volume = it }, "${(volume * 100).toInt()}%", steps = 11)
        }
        NativeGroupTitle("Дополнительные возможности", description = "Скачиваются по желанию и дальше работают без интернета.")
        NativeFeatureTile(
            "Распознавание ЭКГ по фото",
            "Не скачано · 18,4 МБ",
            summary = "Сфотографируйте ленту ЭКГ: MiniMed оцифрует кривые и поможет измерить интервалы. Фото и результаты не покидают устройство.",
            icon = glyph(NativeAppGlyphName.Microscope),
            actions = { NativePrimaryButton("Скачать", {}) },
            details = { NativeTextLink("Что внутри и ограничения", {}) },
            detailsTitle = "Что внутри и ограничения",
        )
        NativeFeatureTile(
            "Расшифровка голосовых заметок",
            "Выключено",
            summary = "Голосовые заметки превращаются в текст прямо на устройстве, запись никуда не отправляется. Модель скачивается один раз.",
            icon = glyph(NativeAppGlyphName.Microphone),
            details = {
                NativeChoiceGroup(
                    "Режим расшифровки",
                    listOf(
                        NativeChoice("Выключено", "Голосовые заметки сохраняются без текста."),
                        NativeChoice("Быстрая", "Для записи в тихой обстановке. Скачивается быстрее и занимает меньше памяти."),
                        NativeChoice("Точная", "Лучше разбирает речь с шумом. Файлы больше, расшифровка медленнее."),
                    ),
                    speech,
                    { speech = it },
                )
            },
            detailsTitle = "Режим и модели",
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            NativeTextLink("GitHub", {})
            NativeTextLink("Android APK", {})
        }
    }
}

/**
 * The WebView «Ваши файлы» page rebuilt from design-system parts (`?scene=design-files`).
 * Developer tool, not the product screen.
 */
@Composable
fun NativeLibraryGallery() {
    val components = NativeDesign.components
    var query by remember { mutableStateOf("") }
    var view by remember { mutableIntStateOf(0) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 10.dp, end = 10.dp, top = 18.dp, bottom = 96.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            NativeIconButton(components.backButton, "back-button", "Назад", {}, icon = glyph(NativeAppGlyphName.ArrowLeft))
            NativeSearchField(query, { query = it }, "Название или файл", Modifier.weight(1f), icon = glyph(NativeAppGlyphName.Search))
        }
        Spacer(Modifier.size(4.dp))
        NativeBreadcrumbs(listOf(NativeCrumb("Ваши файлы", glyph(NativeAppGlyphName.House, 12))), {})
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
            NativeIconButton(components.sortButton, "sort-button", "Сортировка", {}, icon = glyph(NativeAppGlyphName.ArrowsDownUp, 16))
            NativeIconToggle(
                listOf("Плитка" to glyph(NativeAppGlyphName.SquaresFour, 14), "Список" to glyph(NativeAppGlyphName.ListBullets, 14)),
                view,
                { view = it },
            )
            NativeIconButton(components.addButton, "add-button", "Добавить", {}, icon = glyph(NativeAppGlyphName.Plus, 18))
        }
        val folders = listOf(
            Triple("Исследования", "2 вложения", NativeAppGlyphName.Microscope),
            Triple("Книги", "0 вложений", NativeAppGlyphName.BookOpen),
            Triple("Мои опросники", "0 вложений", NativeAppGlyphName.ListChecks),
            Triple("Мои шаблоны", "0 вложений", NativeAppGlyphName.Notepad),
            Triple("Заметки", "0 вложений", NativeAppGlyphName.Notepad),
            Triple("База знаний", "Документы и справочники", NativeAppGlyphName.Books),
            Triple("Пациенты", "Отдельное хранилище пациентов", NativeAppGlyphName.Users),
        )
        for (pair in folders.chunked(2)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for ((title, details, icon) in pair) {
                    NativeFolderCard(
                        title,
                        details,
                        {},
                        Modifier.weight(1f),
                        pinned = title in setOf("Мои опросники", "Мои шаблоны", "Заметки", "База знаний"),
                        icon = glyph(icon, 20),
                        pin = glyph(NativeAppGlyphName.PushPin, 12),
                    )
                }
                if (pair.size == 1) Box(Modifier.weight(1f))
            }
        }
    }
}
