package dev.localmed.nativespike.shared.text

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TextNormalizationTest {

    @Test
    fun normalizeSurfaceText_lowercases_and_folds_yo() {
        assertEquals("менингит у ребенка", normalizeSurfaceText("Менингит у ребёнка"))
    }

    @Test
    fun normalizeSurfaceText_unifies_dash_variants() {
        // en dash, em dash, minus sign all fold to a plain hyphen.
        assertEquals("b38.7 - test", normalizeSurfaceText("B38.7 – test"))
        assertEquals("b38.7 - test", normalizeSurfaceText("B38.7 — test"))
    }

    @Test
    fun normalizeSurfaceText_strips_unsupported_punctuation_to_space() {
        // ';', '(', ')', '!' are not in the allowed charset and fold to whitespace; '.', ',', ':',
        // '+', '/', '%', '-' are explicitly allowed through (matches the TS baseline's charset —
        // see packages/search-lexical/src/normalize.ts's own KEEP_CHARS-equivalent regex).
        assertEquals("бронхит или пневмония", normalizeSurfaceText("бронхит; или (пневмония)!"))
    }

    @Test
    fun normalizeSurfaceText_keeps_the_whitelisted_punctuation() {
        assertEquals("мкб-10: e10.1, 5%", normalizeSurfaceText("МКБ-10: E10.1, 5%"))
    }

    @Test
    fun tokenize_drops_stop_words_and_short_tokens() {
        val tokens = tokenize("менингит или энцефалит у ребёнка")
        assertEquals(listOf("менингит", "энцефалит", "ребенка"), tokens)
    }

    @Test
    fun tokenize_keeps_multi_digit_numbers_but_drops_single_digits() {
        // Same length>=2 floor as word tokens (packages/search-lexical/src/normalize.ts's
        // `tokenize`) — a lone digit is noise, "25" is a meaningful age/dose/code fragment.
        val tokens = tokenize("ребёнка 5 лет, доза 25 мг")
        assertTrue("25" in tokens)
        assertTrue("5" !in tokens)
    }

    @Test
    fun lightStemRussian_strips_a_known_suffix_above_min_length() {
        assertEquals("менингит", lightStemRussian("менингита"))
    }

    @Test
    fun lightStemRussian_leaves_short_tokens_untouched() {
        // "боль" is 4 chars, below the 5-char floor for stemming.
        assertEquals("боль", lightStemRussian("боль"))
    }

    @Test
    fun lightStemRussian_leaves_non_cyrillic_tokens_untouched() {
        assertEquals("amoxicillin", lightStemRussian("amoxicillin"))
    }

    @Test
    fun buildMatchExpression_returns_null_for_a_stopword_only_query() {
        assertEquals(null, buildMatchExpression("и или на", emptyList()))
    }

    @Test
    fun buildMatchExpression_ORs_prefix_terms_for_token_and_stem() {
        val expr = buildMatchExpression("менингита", emptyList())
        requireNotNull(expr)
        assertTrue(expr.contains("менингита*"))
        assertTrue(expr.contains("менингит*"))
        assertTrue(expr.contains(" OR "))
    }

    @Test
    fun buildMatchExpression_expands_alias_canonical_terms_too() {
        val expr = buildMatchExpression("орви", listOf("острая респираторная вирусная инфекция"))
        requireNotNull(expr)
        assertTrue(expr.contains("орви*"))
        assertTrue(expr.contains("респираторная*"))
    }
}
