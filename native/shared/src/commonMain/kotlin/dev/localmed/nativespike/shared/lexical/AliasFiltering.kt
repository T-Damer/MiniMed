package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.AliasRecord
import dev.localmed.nativespike.shared.text.lightStemRussian
import dev.localmed.nativespike.shared.text.normalizeSurfaceText
import dev.localmed.nativespike.shared.text.tokenize

/**
 * A Kotlin port of `filterQueryAliases`/`isComponentMedicationAlias`/`isFixedCombinationTerm`
 * (`packages/core/src/create-medical-core.ts`) — technically defined in `create-medical-core.ts`,
 * not `aliases.ts`, but this is alias-vocabulary *preparation* (run once per query before
 * `createAliasExpander` ever sees the list), not query-plan branching, so it is in scope for stage
 * 2 sub-stage A: without it, single/zero-length-normalized aliases (e.g. a real `core.db` row with
 * `alias = "2"`, `category = "medication"`) and medication-combination-component aliases produce
 * matches the real pipeline deliberately excludes — found via a golden-parity mismatch on
 * "понос или рвота у ребенка 2 лет" during this sub-stage's own verification.
 */

/** Mirrors `isFixedCombinationTerm`. */
fun isFixedCombinationTerm(term: String): Boolean {
    val normalizedTerm = normalizeSurfaceText(term)
    if (normalizedTerm.any { it == '+' || it == ';' || it == '/' }) return true
    return containsStandaloneRussianAnd(normalizedTerm)
}

/** Mirrors the TS regex `/(?:^|\s)и(?:\s|$)/u` without `Regex` — same Kotlin/Native Cyrillic
 * character-class caution as `text/TextNormalization.kt` (see its header). */
private fun containsStandaloneRussianAnd(term: String): Boolean {
    var index = term.indexOf('и')
    while (index >= 0) {
        val before = if (index > 0) term[index - 1] else null
        val after = if (index + 1 < term.length) term[index + 1] else null
        val beforeOk = before == null || before.isWhitespace()
        val afterOk = after == null || after.isWhitespace()
        if (beforeOk && afterOk) return true
        index = term.indexOf('и', index + 1)
    }
    return false
}

/** Mirrors `isComponentMedicationAlias`. */
fun isComponentMedicationAlias(alias: AliasRecord): Boolean {
    if (alias.category != "medication") return false
    val normalizedAlias = normalizeSurfaceText(alias.alias)
    val normalizedCanonicalTerm = normalizeSurfaceText(alias.canonicalTerm)
    if (normalizedAlias == normalizedCanonicalTerm) return false
    if (!isFixedCombinationTerm(normalizedCanonicalTerm)) return false
    // The light stemmer needs a second pass to align «инфекции» and «инфекций» — mirrors the TS
    // source's `.map(lightStemRussian).map(lightStemRussian)` double application exactly.
    val stemmedCanonical = tokenize(normalizedCanonicalTerm).joinToString(" ") { lightStemRussian(lightStemRussian(it)) }
    val stemmedAlias = tokenize(normalizedAlias).joinToString(" ") { lightStemRussian(lightStemRussian(it)) }
    return findNormalizedPhraseIndex(stemmedCanonical, stemmedAlias) >= 0
}

/** Mirrors `filterQueryAliases`. */
fun filterQueryAliases(aliases: List<AliasRecord>): List<AliasRecord> =
    aliases.filter { normalizeSurfaceText(it.alias).length >= 2 && !isComponentMedicationAlias(it) }
