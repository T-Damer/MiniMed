package dev.localmed.nativespike.shared.reader

import dev.localmed.nativespike.shared.reader.NativeInline.Text
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class NativeMarkdownImporterTest {
    @Test
    fun headingsGetWebAnchorsAndTheOutline() {
        val document = NativeMarkdownImporter.import(
            """
            # Пневмония (внебольничная)

            ## Лечение

            Текст.

            ## Лечение

            Setext
            ------
            """.trimIndent(),
        )
        assertEquals(
            listOf(
                NativeOutlineItem("md-пневмония-внебольничная", "Пневмония (внебольничная)", 1),
                NativeOutlineItem("md-лечение", "Лечение", 2),
                NativeOutlineItem("md-лечение-2", "Лечение", 2),
                NativeOutlineItem("md-setext", "Setext", 2),
            ),
            document.outline,
        )
        assertEquals(NativeBlock.Paragraph(listOf(Text("Текст."))), document.blocks[2])
    }

    @Test
    fun inlineMarkupKeepsEveryCharacterOfText() {
        val paragraph = NativeMarkdownImporter.import(
            "Доза *500* **мг**, ==важно==, ~~старое~~, `код`, [ссылка](https://example.org \"t\"), " +
                "<https://a.ru>, \\*не курсив\\*, &laquo;кавычки&raquo;, строка  \nперенос<br>ещё и \$x^2\$",
        ).blocks.single()
        assertEquals(
            NativeBlock.Paragraph(
                listOf(
                    Text("Доза "), NativeInline.Emphasis(listOf(Text("500"))), Text(" "),
                    NativeInline.Strong(listOf(Text("мг"))), Text(", "),
                    NativeInline.Mark(listOf(Text("важно"))), Text(", "),
                    NativeInline.Strike(listOf(Text("старое"))), Text(", "),
                    NativeInline.Code("код"), Text(", "),
                    NativeInline.Link("https://example.org", listOf(Text("ссылка"))), Text(", "),
                    NativeInline.Link("https://a.ru", listOf(Text("https://a.ru"))),
                    Text(", *не курсив*, «кавычки», строка"), NativeInline.LineBreak,
                    Text("перенос"), NativeInline.LineBreak, Text("ещё и "), NativeInline.Math("x^2"),
                ),
            ),
            paragraph,
        )
    }

    @Test
    fun listsTasksQuotesAlertsCodeAndRules() {
        val blocks = NativeMarkdownImporter.import(
            """
            3. третий
            4. четвёртый
               - вложенный

            - [x] сделано
            - [ ] нет

            > цитата

            > [!WARNING]
            > осторожно

            ```kotlin
            val a = 1
              val b = 2
            ```

                отступ

            ---
            """.trimIndent(),
        ).blocks
        val ordered = assertIs<NativeBlock.ListBlock>(blocks[0])
        assertEquals(true, ordered.ordered)
        assertEquals(3, ordered.start)
        assertEquals(listOf(NativeBlock.Paragraph(listOf(Text("третий")))), ordered.items[0].blocks)
        val nested = assertIs<NativeBlock.ListBlock>(ordered.items[1].blocks[1])
        assertEquals(false, nested.ordered)
        val tasks = assertIs<NativeBlock.ListBlock>(blocks[1])
        assertEquals(listOf(true, false), tasks.items.map { it.checked })
        assertEquals(listOf("сделано", "нет"), tasks.items.map { it.blocks.single().plainText() })
        assertEquals(NativeBlock.Quote(listOf(NativeBlock.Paragraph(listOf(Text("цитата"))))), blocks[2])
        val alert = assertIs<NativeBlock.Quote>(blocks[3])
        assertEquals("WARNING", alert.alert)
        assertEquals("осторожно", alert.blocks.joinToString { it.plainText() })
        assertEquals(NativeBlock.Code("val a = 1\n  val b = 2", "kotlin"), blocks[4])
        assertEquals(NativeBlock.Code("отступ", null), blocks[5])
        assertEquals(NativeBlock.Rule, blocks[6])
    }

    @Test
    fun tablesKeepAlignmentAndHeaderCells() {
        val table = assertIs<NativeBlock.Table>(
            NativeMarkdownImporter.import(
                """
                | Возраст | Мальчики | Девочки |
                | :--- | ---: | :---: |
                | 0–<1 года | 93–134 | **90** |
                """.trimIndent(),
            ).blocks.single(),
        )
        assertEquals(listOf(true, true, true), table.rows[0].cells.map { it.header })
        assertEquals(listOf(NativeCellAlign.Start, NativeCellAlign.End, NativeCellAlign.Center), table.rows[1].cells.map { it.align })
        assertEquals(listOf("0–<1 года", "93–134", "90"), table.rows[1].cells.map { it.inlines.plainText() })
        assertEquals(listOf(NativeInline.Strong(listOf(Text("90")))), table.rows[1].cells[2].inlines)
    }

    @Test
    fun standaloneImagesReferenceLinksAndHtmlBlocks() {
        val blocks = NativeMarkdownImporter.import(
            """
            ![Рентген](images/xray.png "Снимок")

            См. [источник][кр] и [кр].

            <div class="note">Текст <b>из</b> HTML</div>

            [кр]: https://cr.minzdrav.gov.ru/ "КР"
            """.trimIndent(),
        ).blocks
        assertEquals(NativeBlock.Image("images/xray.png", "Рентген", "Снимок"), blocks[0])
        assertEquals(
            NativeBlock.Paragraph(
                listOf(
                    Text("См. "), NativeInline.Link("https://cr.minzdrav.gov.ru/", listOf(Text("источник"))),
                    Text(" и "), NativeInline.Link("https://cr.minzdrav.gov.ru/", listOf(Text("кр"))), Text("."),
                ),
            ),
            blocks[1],
        )
        assertEquals(NativeBlock.Raw("Текст из HTML"), blocks[2])
        assertEquals(3, blocks.size)
    }

    @Test
    fun displayMathKeepsItsTexSource() {
        val blocks = NativeMarkdownImporter.import("${'$'}${'$'}\n\\int_0^1 x^2\\,dx\n${'$'}${'$'}\n\nТекст ${'$'}${'$'}a+b${'$'}${'$'} внутри.").blocks
        assertEquals(NativeBlock.Math("\\int_0^1 x^2\\,dx"), blocks[0])
        assertEquals(
            NativeBlock.Paragraph(listOf(Text("Текст "), NativeInline.Math("a+b"), Text(" внутри."))),
            blocks[1],
        )
    }

    @Test
    fun tableCellsBeyondTheHeaderAreKept() {
        val table = assertIs<NativeBlock.Table>(
            NativeMarkdownImporter.import("| A | B |\n| --- | --- |\n| 1 | 2 | лишняя *ячейка* | `a|b` |\n| 3 |").blocks.single(),
        )
        assertEquals(listOf("1", "2", "лишняя ячейка", "a|b"), table.rows[1].cells.map { it.inlines.plainText() })
        assertEquals(listOf(Text("лишняя "), NativeInline.Emphasis(listOf(Text("ячейка")))), table.rows[1].cells[2].inlines)
        assertEquals(listOf("3"), table.rows[2].cells.map { it.inlines.plainText() })
        assertEquals(listOf("a", "b \\| c", "`x|y`"), NativeMarkdownImporter.splitRow("| a | b \\| c | `x|y` |"))
    }
}
