package dev.localmed.nativespike.shared.reader

/** A file the user opened: its name, the type the platform reported, and its bytes. */
class NativeOpenedFile(val name: String, val mimeType: String?, val bytes: ByteArray)

enum class NativeFileFormat { Markdown, Text, Html, Pdf, Epub, Unsupported }

/** What the reader shows for an opened file. */
sealed interface NativeReaderContent {
    val title: String

    data class Document(override val title: String, val document: NativeDocument, val format: NativeFileFormat) : NativeReaderContent

    /** PDF keeps its bytes: pages are drawn by the platform (docs/NATIVE_READER.md, R3). */
    class Pdf(override val title: String, val bytes: ByteArray) : NativeReaderContent

    data class Unsupported(override val title: String, val reason: String) : NativeReaderContent
}

object NativeFileImport {
    /** Text formats above this size are not parsed at once (the web reader's worker limit is far lower). */
    const val MAX_TEXT_BYTES = 32 * 1024 * 1024

    fun format(name: String, mimeType: String?, bytes: ByteArray): NativeFileFormat {
        val extension = name.substringAfterLast('.', "").lowercase()
        val mime = mimeType?.substringBefore(';')?.trim()?.lowercase().orEmpty()
        return when {
            bytes.startsWith(PDF_MAGIC) || extension == "pdf" || mime == "application/pdf" -> NativeFileFormat.Pdf
            extension == "epub" || mime == "application/epub+zip" -> NativeFileFormat.Epub
            extension in MARKDOWN_EXTENSIONS || mime == "text/markdown" || mime == "text/x-markdown" -> NativeFileFormat.Markdown
            extension in HTML_EXTENSIONS || mime == "text/html" || mime == "application/xhtml+xml" -> NativeFileFormat.Html
            extension in TEXT_EXTENSIONS || mime.startsWith("text/") -> NativeFileFormat.Text
            bytes.startsWith(ZIP_MAGIC) -> NativeFileFormat.Unsupported
            extension.isEmpty() && looksLikeText(bytes) -> NativeFileFormat.Text
            else -> NativeFileFormat.Unsupported
        }
    }

    fun open(file: NativeOpenedFile): NativeReaderContent {
        val fallbackTitle = file.name.substringBeforeLast('.').ifBlank { file.name }
        val format = format(file.name, file.mimeType, file.bytes)
        if (format in TEXT_FORMATS && file.bytes.size > MAX_TEXT_BYTES) {
            return NativeReaderContent.Unsupported(fallbackTitle, "Файл больше 32 МБ: такой текст пока не открывается целиком.")
        }
        return when (format) {
            NativeFileFormat.Pdf -> NativeReaderContent.Pdf(fallbackTitle, file.bytes)
            NativeFileFormat.Markdown -> {
                val document = NativeMarkdownImporter.import(NativeTextDecoding.decode(file.bytes))
                NativeReaderContent.Document(firstHeading(document) ?: fallbackTitle, document, format)
            }
            NativeFileFormat.Html -> {
                val (document, title) = NativeHtmlImporter.import(NativeTextDecoding.decode(file.bytes, NativeTextDecoding.declaredHtmlCharset(file.bytes)))
                NativeReaderContent.Document(title ?: firstHeading(document) ?: fallbackTitle, document, format)
            }
            NativeFileFormat.Text -> NativeReaderContent.Document(fallbackTitle, NativePlainTextImporter.import(NativeTextDecoding.decode(file.bytes)), format)
            NativeFileFormat.Epub -> NativeReaderContent.Unsupported(fallbackTitle, "EPUB откроется в одной из следующих версий читалки.")
            NativeFileFormat.Unsupported -> NativeReaderContent.Unsupported(fallbackTitle, "Этот формат читалка пока не открывает. Поддерживаются PDF, Markdown, HTML и текст.")
        }
    }

    private fun firstHeading(document: NativeDocument): String? =
        document.outline.firstOrNull { it.depth == 1 }?.label?.takeIf { it.isNotBlank() }

    /** No NUL bytes in the first 4 KiB: text, not a binary format. */
    private fun looksLikeText(bytes: ByteArray): Boolean = (0 until minOf(bytes.size, 4096)).none { bytes[it] == 0.toByte() }

    private fun ByteArray.startsWith(prefix: ByteArray): Boolean = size >= prefix.size && prefix.indices.all { this[it] == prefix[it] }

    private val PDF_MAGIC = "%PDF-".encodeToByteArray()
    private val ZIP_MAGIC = byteArrayOf(0x50, 0x4B, 0x03, 0x04)
    private val MARKDOWN_EXTENSIONS = setOf("md", "markdown", "mdown", "mkd", "mkdn")
    private val HTML_EXTENSIONS = setOf("html", "htm", "xhtml", "xht")
    private val TEXT_EXTENSIONS = setOf("txt", "text", "log", "csv", "tsv")
    private val TEXT_FORMATS = setOf(NativeFileFormat.Markdown, NativeFileFormat.Html, NativeFileFormat.Text)
}

/** Plain text: paragraphs at blank lines, line breaks kept inside them; nothing interpreted. */
object NativePlainTextImporter {
    fun import(text: String): NativeDocument {
        val paragraphs = text.replace("\r\n", "\n").replace('\r', '\n').split(BLANK_LINES).filter { it.isNotBlank() }
        val blocks = paragraphs.map { paragraph ->
            val lines = paragraph.trim('\n').split('\n')
            NativeBlock.Paragraph(lines.flatMapIndexed { index, line -> if (index == 0) listOf(NativeInline.Text(line)) else listOf(NativeInline.LineBreak, NativeInline.Text(line)) })
        }
        return NativeDocument(blocks, emptyList())
    }

    private val BLANK_LINES = Regex("""\n(?:[ \t]*\n)+""")
}

/**
 * Text decoding for files of unknown origin: a byte-order mark wins, then a declared charset,
 * then strict UTF-8; text that is not valid UTF-8 is read as Windows-1251, the usual legacy
 * encoding of Russian documents.
 */
object NativeTextDecoding {
    fun decode(bytes: ByteArray, declared: String? = null): String {
        if (bytes.size >= 3 && bytes[0] == 0xEF.toByte() && bytes[1] == 0xBB.toByte() && bytes[2] == 0xBF.toByte()) {
            return bytes.decodeToString(3, bytes.size)
        }
        if (bytes.size >= 2 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xFE.toByte()) return utf16(bytes, 2, littleEndian = true)
        if (bytes.size >= 2 && bytes[0] == 0xFE.toByte() && bytes[1] == 0xFF.toByte()) return utf16(bytes, 2, littleEndian = false)
        val charset = declared?.lowercase()
        if (charset in CP1251_NAMES) return cp1251(bytes)
        return try {
            bytes.decodeToString(throwOnInvalidSequence = true)
        } catch (_: CharacterCodingException) {
            cp1251(bytes)
        }
    }

    /** The `charset` an HTML file declares in its first 2 KiB, if any. */
    fun declaredHtmlCharset(bytes: ByteArray): String? {
        val head = CharArray(minOf(bytes.size, 2048)) { (bytes[it].toInt() and 0x7F).toChar() }.concatToString()
        return CHARSET.find(head)?.groupValues?.get(1)
    }

    private fun utf16(bytes: ByteArray, from: Int, littleEndian: Boolean): String {
        val chars = CharArray((bytes.size - from) / 2) { index ->
            val a = bytes[from + index * 2].toInt() and 0xFF
            val b = bytes[from + index * 2 + 1].toInt() and 0xFF
            (if (littleEndian) (b shl 8) or a else (a shl 8) or b).toChar()
        }
        return chars.concatToString()
    }

    private fun cp1251(bytes: ByteArray): String =
        CharArray(bytes.size) { index ->
            val byte = bytes[index].toInt() and 0xFF
            if (byte < 0x80) byte.toChar() else CP1251_HIGH[byte - 0x80]
        }.concatToString()

    private val CHARSET = Regex("""charset\s*=\s*["']?([A-Za-z0-9_-]+)""", RegexOption.IGNORE_CASE)
    private val CP1251_NAMES = setOf("windows-1251", "cp1251", "x-cp1251", "win-1251")

    /** Windows-1251 bytes 0x80–0xFF (0x98 is unassigned and maps to U+FFFD). */
    private val CP1251_HIGH: CharArray = (
        "ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏ" +
            "ђ‘’“”•–—�™љ›њќћџ" +
            " ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї" +
            "°±Ііґµ¶·ё№є»јЅѕї"
        ).toCharArray() + CharArray(64) { (0x0410 + it).toChar() }
}
