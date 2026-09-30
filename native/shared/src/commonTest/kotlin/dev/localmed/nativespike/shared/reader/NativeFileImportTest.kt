package dev.localmed.nativespike.shared.reader

import dev.localmed.nativespike.shared.reader.NativeInline.Text
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class NativeFileImportTest {
    @Test
    fun htmlKeepsContentAndDropsScriptsStylesAndForms() {
        val (document, title) = NativeHtmlImporter.import(
            """
            <html><head><title>Памятка</title><style>p{color:red}</style><script>alert(1)</script></head>
            <body>
              <h1 id="top">Пневмония</h1>
              <div>Текст   без <b>абзаца</b><br>с переносом</div>
              <p>См. <a href="#top">начало</a>, <a href="javascript:x()">скрипт</a> и <img src="a.png" alt="схема">.</p>
              <form><input value="секрет"><button>Отправить</button></form>
              <ul><li>один</li><li><p>два</p><ol start="3"><li>три</li></ol></li></ul>
              <table><tr><th colspan="2">Шапка</th></tr><tr><td align="right">1</td><td>2</td></tr></table>
              <figure><img src="b.jpg" alt="рентген"><figcaption>Рис. 1</figcaption></figure>
              <pre><code class="language-sql">select 1;
            </code></pre>
              <iframe src="https://evil.example"></iframe>
              <h2>Без id</h2>
            </body></html>
            """.trimIndent(),
        )
        assertEquals("Памятка", title)
        val blocks = document.blocks
        assertEquals(NativeBlock.Heading(1, listOf(Text("Пневмония")), "top"), blocks[0])
        assertEquals(
            NativeBlock.Paragraph(listOf(Text("Текст без "), NativeInline.Strong(listOf(Text("абзаца"))), NativeInline.LineBreak, Text("с переносом"))),
            blocks[1],
        )
        assertEquals(
            NativeBlock.Paragraph(
                listOf(Text("См. "), NativeInline.Link("#top", listOf(Text("начало"))), Text(", скрипт и "), NativeInline.Image("a.png", "схема"), Text(".")),
            ),
            blocks[2],
        )
        val list = assertIs<NativeBlock.ListBlock>(blocks[3])
        assertEquals(2, list.items.size)
        assertEquals(3, assertIs<NativeBlock.ListBlock>(list.items[1].blocks[1]).start)
        val table = assertIs<NativeBlock.Table>(blocks[4])
        assertEquals(2, table.rows[0].cells.single().colSpan)
        assertEquals(NativeCellAlign.End, table.rows[1].cells[0].align)
        assertEquals(NativeBlock.Image("b.jpg", "рентген", "Рис. 1"), blocks[5])
        assertEquals(NativeBlock.Code("select 1;", "sql"), blocks[6])
        assertEquals(NativeOutlineItem("md-без-id", "Без id", 2), document.outline.last())
        assertEquals(8, blocks.size, blocks.joinToString("\n"))
        val text = blocks.joinToString(" ") { it.plainText() }
        for (hidden in listOf("alert", "color:red", "секрет", "Отправить", "evil")) assertEquals(false, hidden in text, hidden)
    }

    @Test
    fun formatsFollowMagicBytesThenExtensionThenType() {
        val pdf = "%PDF-1.7".encodeToByteArray()
        assertEquals(NativeFileFormat.Pdf, NativeFileImport.format("scan.bin", null, pdf))
        assertEquals(NativeFileFormat.Markdown, NativeFileImport.format("notes.MD", null, "# x".encodeToByteArray()))
        assertEquals(NativeFileFormat.Html, NativeFileImport.format("page", "text/html; charset=utf-8", "<p>".encodeToByteArray()))
        assertEquals(NativeFileFormat.Text, NativeFileImport.format("README", null, "plain".encodeToByteArray()))
        assertEquals(NativeFileFormat.Epub, NativeFileImport.format("book.epub", null, byteArrayOf(0x50, 0x4B, 3, 4)))
        assertEquals(NativeFileFormat.Unsupported, NativeFileImport.format("report.docx", null, byteArrayOf(0x50, 0x4B, 3, 4)))
        assertEquals(NativeFileFormat.Unsupported, NativeFileImport.format("blob", null, byteArrayOf(1, 0, 2)))
    }

    @Test
    fun legacyRussianTextIsDecodedAsWindows1251() {
        // «Привет, ёж №1» in Windows-1251.
        val cp1251 = intArrayOf(0xCF, 0xF0, 0xE8, 0xE2, 0xE5, 0xF2, 0x2C, 0x20, 0xB8, 0xE6, 0x20, 0xB9, 0x31).map { it.toByte() }.toByteArray()
        assertEquals("Привет, ёж №1", NativeTextDecoding.decode(cp1251))
        assertEquals("Привет", NativeTextDecoding.decode(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + "Привет".encodeToByteArray()))
        assertEquals("windows-1251", NativeTextDecoding.declaredHtmlCharset("<meta charset=\"windows-1251\">".encodeToByteArray()))
        val html = "<html><head><meta charset=windows-1251><title>".encodeToByteArray() + byteArrayOf(0xCF.toByte(), 0xF0.toByte()) + "</title></head></html>".encodeToByteArray()
        assertEquals("Пр", NativeFileImport.open(NativeOpenedFile("a.html", null, html)).title)
    }

    @Test
    fun plainTextKeepsLinesAndParagraphs() {
        val document = NativePlainTextImporter.import("Первая строка\r\nвторая\n\n  \nНовый абзац")
        assertEquals(
            listOf(
                NativeBlock.Paragraph(listOf(Text("Первая строка"), NativeInline.LineBreak, Text("вторая"))),
                NativeBlock.Paragraph(listOf(Text("Новый абзац"))),
            ),
            document.blocks,
        )
    }

    @Test
    fun openedFilesBecomeReaderContent() {
        val markdown = NativeFileImport.open(NativeOpenedFile("x.md", null, "# Заголовок\n\nТекст".encodeToByteArray()))
        assertEquals("Заголовок", assertIs<NativeReaderContent.Document>(markdown).title)
        assertIs<NativeReaderContent.Pdf>(NativeFileImport.open(NativeOpenedFile("x.pdf", "application/pdf", "%PDF-1.4".encodeToByteArray())))
        assertIs<NativeReaderContent.Unsupported>(NativeFileImport.open(NativeOpenedFile("x.exe", null, byteArrayOf(0x4D, 0x5A, 0, 1))))
    }
}
