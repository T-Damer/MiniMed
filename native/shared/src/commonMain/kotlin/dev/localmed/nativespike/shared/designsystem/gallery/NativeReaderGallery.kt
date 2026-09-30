package dev.localmed.nativespike.shared.designsystem.gallery

import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.RowScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.designsystem.NativeDocumentReader
import dev.localmed.nativespike.shared.designsystem.NativeFileReader
import dev.localmed.nativespike.shared.designsystem.NativeReaderTool
import dev.localmed.nativespike.shared.designsystem.NativeReaderGlyphs
import dev.localmed.nativespike.shared.reader.NativeFileImport
import dev.localmed.nativespike.shared.reader.NativeFilePick
import dev.localmed.nativespike.shared.reader.NativeMarkdownImporter
import dev.localmed.nativespike.shared.reader.NativeReaderContent
import dev.localmed.nativespike.shared.reader.nativeFilePickerAvailable
import dev.localmed.nativespike.shared.reader.rememberNativeFilePicker
import dev.localmed.nativespike.shared.ui.NativeAppGlyph
import dev.localmed.nativespike.shared.ui.NativeAppGlyphName

/**
 * The design-system reader over a Markdown sample, with «open file» where the platform has a
 * picker: PDF, Markdown, HTML and text open in the same reader. Developer tool
 * (`?scene=design-reader`, Android debug «Reader lab»).
 */
@Composable
fun NativeReaderGallery(markdown: String = SAMPLE_MARKDOWN, initialFind: String = "", initialFile: NativeReaderContent? = null) {
    val document = remember(markdown) { NativeMarkdownImporter.import(markdown) }
    val glyphs = nativeGalleryReaderGlyphs()
    var opened by remember { mutableStateOf(initialFile) }
    val pick = rememberNativeFilePicker { result ->
        when (result) {
            is NativeFilePick.Picked -> opened = NativeFileImport.open(result.file)
            is NativeFilePick.Failed -> opened = NativeReaderContent.Unsupported("Файл не открыт", result.message)
            NativeFilePick.Cancelled -> Unit
        }
    }
    val openTool: @Composable RowScope.() -> Unit = {
        if (nativeFilePickerAvailable) {
            NativeReaderTool("Открыть файл", pick) { tint -> NativeAppGlyph(NativeAppGlyphName.FolderOpen, Modifier.size(20.dp), tint) }
        }
    }
    val file = opened
    if (file != null) {
        NativeFileReader(file, onBack = { opened = null }, glyphs = glyphs, tools = openTool)
    } else {
        NativeDocumentReader("Пример документа Markdown", document, onBack = {}, glyphs = glyphs, initialFind = initialFind, tools = openTool)
    }
}

/** The shared glyph set in the reader's icon slots. */
fun nativeGalleryReaderGlyphs(): NativeReaderGlyphs {
    val glyph = { name: NativeAppGlyphName, size: Int -> @Composable { tint: Color -> NativeAppGlyph(name, Modifier.size(size.dp), tint) } }
    return NativeReaderGlyphs(
        back = glyph(NativeAppGlyphName.ArrowLeft, 20),
        outline = glyph(NativeAppGlyphName.ListBullets, 20),
        find = glyph(NativeAppGlyphName.Search, 20),
        settings = glyph(NativeAppGlyphName.TextAa, 20),
        previous = glyph(NativeAppGlyphName.CaretUp, 16),
        next = glyph(NativeAppGlyphName.CaretDown, 16),
        close = glyph(NativeAppGlyphName.Close, 16),
        top = glyph(NativeAppGlyphName.ArrowUp, 20),
    )
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
