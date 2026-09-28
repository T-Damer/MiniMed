package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.AliasExpansion
import dev.localmed.nativespike.shared.model.AliasRecord
import dev.localmed.nativespike.shared.model.LexicalQueryBranchPlan
import dev.localmed.nativespike.shared.model.LookupQueryPlan
import dev.localmed.nativespike.shared.model.QueryBranchKind
import dev.localmed.nativespike.shared.text.lightStemRussian
import dev.localmed.nativespike.shared.text.normalizeSurfaceText
import dev.localmed.nativespike.shared.text.tokenize

/**
 * A Kotlin port of the lookup-plan-building pieces of `packages/search-lexical/src/analysis.ts` —
 * stage 2 sub-stage B of the migration recorded in docs/CURRENT_STATE.md. Ported: `MAX_FTS_TERMS`,
 * `STRUCTURAL_TERMS`, `QUERY_EXPANSIONS`/`QUERY_PHRASE_EXPANSIONS`/`QUERY_EXPANSION_PHRASES`,
 * `ftsToken`, `buildFtsQuery`, `termsWithStems`, `makeBranch`,
 * `ambiguousDiagnosisAliasSurfaceForms`/`splitAliasExpansionTerms` (the strong/diluted
 * diagnosis-alias-branch split, weight 0.35), and `buildLookupQueryPlan` itself. Not ported:
 * everything specific to `analyzeClinicalQuery`/clinical-mode branches (facts, intent,
 * clinicalContext, calculation, suggestions, `buildBranches`, `INTENT_BRANCH`,
 * `strengthPresentationFtsQuery`) — out of scope for stage 2 (docs/CURRENT_STATE.md).
 */

private const val MAX_FTS_TERMS = 34

private val STRUCTURAL_TERMS: Set<String> = setOf(
    "возраст", "пол", "мальчик", "мальчику", "девочка", "девочке", "ребенок", "ребенку",
    "ребёнок", "ребёнку", "пациент", "пациентка", "мужчина", "женщина", "лет", "год", "года",
    "месяц", "месяца", "месяцев", "день", "дня", "дней", "час", "часа", "часов", "неделя",
    "недели", "недель", "сегодня", "вчера", "часто", "быстро", "дышит", "дышать", "позавчера",
    "жалоба", "жалобы", "анамнез", "нет", "принимает", "получает", "назначен", "назначена",
    "первый", "второй", "третий", "четвертый", "четвёртый", "пятый", "со", "слов",
)

private val QUERY_EXPANSIONS: Map<String, List<String>> = mapOf(
    "контоля" to listOf("контроль", "контроля"),
    "ссаденой" to listOf("ссадина", "ссадиной"),
    "ссаденая" to listOf("ссадина"),
    "детский" to listOf("детей"),
    "сироп" to listOf("суспензия для приема внутрь"),
    "спироп" to listOf("сироп", "суспензия для приема внутрь"),
    "суспенз" to listOf("сироп"),
    "суспензи" to listOf("сироп"),
)

private val QUERY_PHRASE_EXPANSIONS: Map<String, List<String>> = mapOf(
    "в/м" to listOf("внутримышечно"),
    "в/в" to listOf("внутривенно"),
)

private val QUERY_EXPANSION_PHRASES: Set<String> =
    QUERY_EXPANSIONS.values.flatten().filter { ' ' in it }.toSet()

/** Mirrors `ftsToken`. */
fun ftsToken(term: String): String {
    val escaped = term.replace("\"", "\"\"")
    return "\"$escaped\"*"
}

/** Mirrors `buildFtsQuery`. */
fun buildFtsQuery(query: String, terms: List<String>, excludedNumericTerms: Set<String>? = null): String {
    val combined = LinkedHashSet<String>()
    for (term in terms) combined.add(ftsToken(term))
    for (icdQuery in icd10LegacyFtsQueries(query, excludedNumericTerms)) combined.add(icdQuery)
    return combined.joinToString(" OR ")
}

/** Mirrors `termsWithStems`. */
fun termsWithStems(values: List<String>, excludedNumericTerms: Set<String>? = null): List<String> {
    val terms = LinkedHashSet<String>()
    val icd10Fragments = icd10CodeFragments(values)
    for (value in values) {
        val normalizedValue = normalizeSurfaceText(value)
        val paddedValue = " $normalizedValue "
        for ((phrase, expansions) in QUERY_PHRASE_EXPANSIONS) {
            if (" $phrase " !in paddedValue) continue
            for (expansion in expansions) {
                terms.add(expansion)
                terms.add(lightStemRussian(expansion))
            }
        }
        if (normalizedValue in QUERY_EXPANSION_PHRASES) {
            terms.add(normalizedValue)
            continue
        }
        for (token in tokenize(value)) {
            if (token in icd10Fragments) continue
            if (token.all { it in '0'..'9' } || token in STRUCTURAL_TERMS) continue
            terms.add(token)
            terms.add(lightStemRussian(token))
            val expansionKeys = linkedSetOf(token, lightStemRussian(token))
            for (expansionKey in expansionKeys) {
                for (expansion in QUERY_EXPANSIONS[expansionKey].orEmpty()) {
                    terms.add(expansion)
                    if (expansion !in QUERY_EXPANSION_PHRASES) terms.add(lightStemRussian(expansion))
                }
            }
        }
    }
    for (term in icd10SearchTerms(values)) {
        if (excludedNumericTerms == null || term !in excludedNumericTerms) terms.add(term)
    }
    return terms.filter { it.length >= 2 }.take(MAX_FTS_TERMS)
}

/** Mirrors `makeBranch`. Returns `null` exactly when the TS source does — no searchable terms. */
fun makeBranch(
    id: String,
    kind: QueryBranchKind,
    label: String,
    query: String,
    values: List<String>,
    weight: Double,
    excludedNumericTerms: Set<String>? = null,
): LexicalQueryBranchPlan? {
    val terms = termsWithStems(values, excludedNumericTerms)
    if (terms.isEmpty()) return null
    return LexicalQueryBranchPlan(
        id = id,
        kind = kind,
        label = label,
        query = query,
        normalizedQuery = normalizeSurfaceText(query),
        terms = terms,
        weight = weight,
        ftsQuery = buildFtsQuery(query, terms, excludedNumericTerms),
    )
}

// At query time an ambiguous diagnosis-alias surface form expands into terms from every one of its
// targets at once, crowding a specific clinical recommendation off a fixed top-k with generic
// reference cards that only share the synonym. Terms reachable ONLY through such an ambiguous
// diagnosis alias go in a separate, lower-weight branch: still searched in full (no recall lost),
// but no longer competing at full strength with the original query words, a clinical pointer's own
// declared alias, or any unambiguous alias in branch fusion (sub-stage D, not yet ported).
const val AMBIGUOUS_ALIAS_BRANCH_WEIGHT: Double = 0.35

/** Mirrors `DILUTED_DIAGNOSIS_ALIAS_BRANCH_ID`. */
const val DILUTED_DIAGNOSIS_ALIAS_BRANCH_ID: String = "lookup-broad-alias"

/** Mirrors `ICD10_LIKE_TOKEN_PATTERN` (`/^[a-zа-я]\d{2,3}$/u`) as a manual check — one letter then
 * 2-3 digits, exact full-string match; `term` here is always already-lowercased (from `tokenize`). */
private fun isIcd10LikeToken(term: String): Boolean {
    if (term.length !in 3..4) return false
    val first = term[0]
    if (first !in 'a'..'z' && first !in 'а'..'я') return false
    return term.drop(1).all { it in '0'..'9' }
}

/** Mirrors `ambiguousDiagnosisAliasSurfaceForms`. Operates only on the query's own matched aliases
 * (`AliasExpansion.matchedAliases`), not the whole vocabulary — no extra DB state needed. */
fun ambiguousDiagnosisAliasSurfaceForms(matchedAliases: List<AliasRecord>): Set<String> {
    val targetsBySurface = LinkedHashMap<String, MutableSet<String>>()
    for (alias in matchedAliases) {
        if (alias.category != "diagnosis") continue
        val surface = normalizeSurfaceText(alias.alias)
        targetsBySurface.getOrPut(surface) { LinkedHashSet() }.add(normalizeSurfaceText(alias.canonicalTerm))
    }
    val ambiguous = LinkedHashSet<String>()
    for ((surface, targets) in targetsBySurface) {
        if (targets.size > 2) ambiguous.add(surface)
    }
    return ambiguous
}

data class AliasTermSplit(val strongTerms: List<String>, val dilutedTerms: List<String>)

/** Mirrors `splitAliasExpansionTerms`. */
fun splitAliasExpansionTerms(matchedAliases: List<AliasRecord>): AliasTermSplit {
    val ambiguousSurfaces = ambiguousDiagnosisAliasSurfaceForms(matchedAliases)
    val strong = LinkedHashSet<String>()
    val diluted = LinkedHashSet<String>()
    for (alias in matchedAliases) {
        val isAmbiguousDiagnosisAlias =
            alias.category == "diagnosis" && ambiguousSurfaces.contains(normalizeSurfaceText(alias.alias))
        for (term in tokenize(alias.canonicalTerm)) {
            val bucket = if (!isAmbiguousDiagnosisAlias || isIcd10LikeToken(term)) strong else diluted
            bucket.add(term)
        }
    }
    return AliasTermSplit(
        strongTerms = strong.toList(),
        // A term shared with an unambiguous/non-diagnosis alias (or the original query) keeps its
        // full strength.
        dilutedTerms = diluted.filter { it !in strong },
    )
}

/**
 * Mirrors `analysis.ts`'s OWN `buildLookupQueryPlan` (the base version, before
 * `medication-lookup.ts`'s wrapper adds the medication-spelling layer — see
 * `MedicationLookupPlan.kt`). "Source lookup keeps vocabulary expansion but does not interpret a
 * patient's clinical case."
 */
fun buildBaseLookupQueryPlan(
    query: String,
    aliases: List<AliasRecord>,
    preparedExpansion: AliasExpansion? = null,
): LookupQueryPlan {
    val expansion = preparedExpansion ?: expandAliases(query, aliases)
    val (strongTerms, dilutedTerms) = splitAliasExpansionTerms(expansion.matchedAliases)
    val branch = makeBranch(
        "lookup", QueryBranchKind.ORIGINAL, "Поиск по источникам", query,
        listOf(query) + strongTerms, 1.0,
    )
    val dilutedBranch = if (dilutedTerms.isNotEmpty()) {
        makeBranch(
            DILUTED_DIAGNOSIS_ALIAS_BRANCH_ID, QueryBranchKind.ORIGINAL,
            "Поиск по источникам (широкий синоним)", query, dilutedTerms, AMBIGUOUS_ALIAS_BRANCH_WEIGHT,
        )
    } else {
        null
    }
    val branches = listOfNotNull(branch, dilutedBranch)
    return LookupQueryPlan(
        branches = branches,
        aliasMatches = expansion.matches,
        terms = branches.flatMap { it.terms }.distinct(),
        ftsQuery = branches.joinToString(" || ") { it.ftsQuery },
    )
}
