package dev.localmed.nativespike.shared

import dev.localmed.nativespike.shared.text.*
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class QueryAlignedSnippetTest {
    @Test
    fun offsets_survive_compatibility_unicode_markup_and_literal_comparisons() {
        val excerpt = buildSnippet("<div><b>Ёж</b>&nbsp;ＡＢＣ<br>температура <38°C [источник]</div>", listOf("еж", "abc", "температура"))
        assertEquals("Ёж ＡＢＣ\nтемпература <38°C [источник]\n", excerpt.text)
        assertEquals(listOf("Ёж", "ＡＢＣ", "температура"), excerpt.ranges.map { excerpt.text.substring(it.start, it.end) })
        assertEquals(excerpt.text, snippetSegments(excerpt.text, excerpt.ranges).joinToString("") { it.text })
    }

    @Test
    fun query_window_finds_the_exact_trade_name_and_its_source_listed_form() {
        val text = "Введение ".repeat(80) + "\nТН: Абактал. Лекарственная форма: таблетки;\n" +
            "Преамбула ".repeat(80) + "\nТН: Нужный препарат; Лекарственная форма: раствор; Нормализованные формы/дозировки: 10 мг;\n"
        val excerpt = buildQueryAlignedSnippet(text, listOf("нужный препарат"))
        assertTrue(excerpt.text.startsWith("…"))
        assertTrue(excerpt.text.contains("ТН: Нужный препарат; Лекарственная форма: раствор"))
        assertTrue(excerpt.ranges.any { excerpt.text.substring(it.start, it.end) == "Нужный препарат" })
        assertEquals(listOf("Нужный препарат", "раствор", "10 мг"), presentationRowTerms(text, listOf("нужный препарат")))
    }

    @Test
    fun offset_mapping_collapses_spaces_and_preserves_surrogate_width() {
        val normalized = normalizeSurfaceTextWithOffsets("  😀Ａ  Ёж—Е11.9  ")
        assertEquals("a еж-e11.9", normalized.text)
        assertEquals(TextRange(4, 5), normalized.offsets.first())
        assertEquals(normalized.text.length, normalized.offsets.size)
    }
}
