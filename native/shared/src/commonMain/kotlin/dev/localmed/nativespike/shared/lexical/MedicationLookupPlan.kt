package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.AliasExpansion
import dev.localmed.nativespike.shared.model.AliasRecord
import dev.localmed.nativespike.shared.model.MedicationLookupPlan
import dev.localmed.nativespike.shared.model.MedicationSpellingInfo
import dev.localmed.nativespike.shared.model.QueryBranchKind

/**
 * A Kotlin port of `packages/search-lexical/src/medication-lookup.ts` — this is the PUBLIC
 * `buildLookupQueryPlan` the real pipeline actually calls (`packages/search-lexical/src/index.ts`
 * re-exports this one, not `analysis.ts`'s own, per `create-medical-core.ts`'s import). It wraps
 * `buildBaseLookupQueryPlan` (`LookupPlan.kt`, analysis.ts's own function) and, when
 * `createMedicationSpellingMatcher` (`MedicationSpelling.kt`) finds candidates, adds a labelled
 * branch per candidate plus a `"${matchedText} → ${name} (возможная опечатка)"` entry onto
 * `aliasMatches` — the exact string shape a golden-parity mismatch traced back to this file during
 * sub-stage A (see that sub-stage's report: "ребенок → Рабелок (возможная опечатка)").
 *
 * Not cached across calls the way the TS source's `WeakMap`/module-level `matchers` cache is
 * (keyed by alias-array identity, purely a performance optimization for repeated calls with the
 * same vocabulary) — this port rebuilds the matcher per call; behaviorally identical, just not
 * memoized, consistent with the rest of this Kotlin port's stance on TS-side caching (see
 * `Aliases.kt`'s header on `expandAliases`'s own `WeakMap`).
 */
fun buildLookupQueryPlan(
    query: String,
    aliases: List<AliasRecord>,
    preparedExpansion: AliasExpansion? = null,
): MedicationLookupPlan {
    val original = buildBaseLookupQueryPlan(query, aliases, preparedExpansion)
    val matcher = createMedicationSpellingMatcher(aliases)
    val candidates = matcher.match(query)
    if (candidates.isEmpty()) {
        return MedicationLookupPlan(
            branches = original.branches,
            aliasMatches = original.aliasMatches,
            terms = original.terms,
            ftsQuery = original.ftsQuery,
            warnings = emptyList(),
            medicationSpellingNames = null,
            medicationSpelling = null,
        )
    }
    val branches = original.branches.toMutableList()
    val seen = HashSet<String>()
    for (candidate in candidates) {
        // Reuse the existing quoted/stemmed query builder; never concatenate user text into SQL.
        // `aliases = emptyList()` + no prepared expansion mirrors the TS call's `[]` aliases and
        // its explicit empty-matchedAliases stub: `buildBaseLookupQueryPlan` only ever reads
        // `expansion.matchedAliases`/`expansion.matches`, both empty either way.
        val corrected = buildBaseLookupQueryPlan(candidate.replacementQuery, emptyList())
        val branch = corrected.branches.firstOrNull() ?: continue
        if (branch.ftsQuery in seen) continue
        seen.add(branch.ftsQuery)
        branches.add(
            branch.copy(
                id = "medication-spelling-${seen.size}",
                kind = QueryBranchKind.MEDICATION,
                label = "Возможная опечатка: ${candidate.name}" +
                    if (candidate.omittedSuffix != null) " (название с уточняющим суффиксом)" else "",
                weight = 0.95 - candidate.cost * 0.02,
            ),
        )
    }
    return MedicationLookupPlan(
        branches = branches,
        aliasMatches = original.aliasMatches + candidates.map { "${it.matchedText} → ${it.name} (возможная опечатка)" },
        terms = branches.flatMap { it.terms }.distinct(),
        ftsQuery = branches.joinToString(" || ") { it.ftsQuery },
        warnings = listOf(
            "Возможная опечатка в названии препарата. Варианты поиска: " +
                "${candidates.joinToString("; ") { it.name }}. " +
                "Проверьте название: это не рекомендация заменить препарат.",
        ),
        medicationSpellingNames = candidates.flatMap { listOf(it.name) + it.canonicalTerms }.distinct(),
        medicationSpelling = MedicationSpellingInfo(candidates.firstOrNull()?.matchedText ?: "", original),
    )
}
