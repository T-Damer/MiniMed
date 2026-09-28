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

    // --- stage 2 sub-stage A additions (docs/CURRENT_STATE.md) ---

    @Test
    fun normalizeSurfaceText_remaps_cyrillic_lookalikes_inside_an_icd10_shaped_token() {
        // Cyrillic А (U+0410) typed instead of Latin A, immediately followed by 2+ digits — the
        // shape ICD10_CODE_LIKE_PATTERN (normalize.ts) targets. Mirrors normalizeIcd10Lookalikes.
        assertEquals("a10", normalizeSurfaceText("А10"))
        // Already-Latin ICD codes are untouched (no Cyrillic lookalikes to remap).
        assertEquals("j18.0", normalizeSurfaceText("J18.0"))
    }

    @Test
    fun normalizeSurfaceText_leaves_ordinary_cyrillic_words_untouched_by_icd10_remapping() {
        // No digits adjacent to the letters, so this never matches the ICD10-code shape and must
        // not be touched — only a code-shaped token gets remapped, not general Cyrillic text.
        assertEquals("апельсин", normalizeSurfaceText("апельсин"))
    }

    @Test
    fun lightStemRussian_strips_the_ya_suffix() {
        // Regression test for a Kotlin-port-only bug found during stage 2 sub-stage A: this suffix
        // list previously had "нья" where normalize.ts has "ья" (a plain transcription typo, not a
        // deliberate difference), which silently broke stemming for every word genuinely ending in
        // "-ья" (e.g. this one) since none of them end in the wrong 3-character "нья" instead.
        assertEquals("здоров", lightStemRussian("здоровья"))
    }

    @Test
    fun isCloseToken_accepts_a_bounded_edit_distance_typo_on_long_tokens() {
        // "иимпрамин" vs "имипрамин": a transposition, Levenshtein distance 2 (no transpose
        // credit), both 9 chars — at the >=9-char band maxDistance is 2, so this must match.
        // (rapidfuzz-parity.fixture.json's "medication.existing.0" — same pair, OSA distance.)
        assertTrue(isCloseToken("иимпрамин", "имипрамин"))
        assertEquals(2, levenshteinDistanceBounded("иимпрамин", "имипрамин", 2))
    }

    @Test
    fun isCloseToken_rejects_short_tokens_even_when_one_edit_apart() {
        // Below MIN_FUZZY_TOKEN_LENGTH (5), only exact matches count — "боль" vs "моль" must not
        // be treated as a typo of each other (see isCloseToken's doc in normalize.ts).
        assertTrue(!isCloseToken("боль", "моль"))
    }
}
