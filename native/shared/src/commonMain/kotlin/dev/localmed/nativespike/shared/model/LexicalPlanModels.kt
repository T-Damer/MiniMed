package dev.localmed.nativespike.shared.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName

/** Mirrors `QueryBranchKind` (packages/contracts/src/search.ts). Only `ORIGINAL` and `MEDICATION`
 * are ever produced by the lookup path (stage 2 sub-stage B); the others are clinical-mode only. */
@Serializable
enum class QueryBranchKind { @SerialName("clinical") CLINICAL, @SerialName("original") ORIGINAL, @SerialName("clause") CLAUSE, @SerialName("investigation") INVESTIGATION, @SerialName("medication") MEDICATION, @SerialName("intent") INTENT }

/** Mirrors `LexicalQueryBranchPlan` (`QueryBranch` + `ftsQuery` — packages/search-lexical/src/analysis.ts). */
@Serializable
data class LexicalQueryBranchPlan(
    val id: String,
    val kind: QueryBranchKind,
    val label: String,
    val query: String,
    val normalizedQuery: String,
    val terms: List<String>,
    val weight: Double,
    val ftsQuery: String,
)

/**
 * A deliberately narrowed mirror of `ClinicalQueryPlan` (analysis.ts) for the lookup path only:
 * drops `analysis` (facts/intent/clinicalContext/calculation are clinical-mode-only fields, always
 * empty/absent for `buildLookupQueryPlan`) and `suggestions` (also hardcoded empty for lookup mode
 * — only `analyzeClinicalQuery` calls `buildSuggestions`). Keeps exactly what stage 2 sub-stage B's
 * golden-parity check compares: `branches`, `aliasMatches`, `terms`, `ftsQuery`.
 */
data class LookupQueryPlan(
    val branches: List<LexicalQueryBranchPlan>,
    val aliasMatches: List<String>,
    val terms: List<String>,
    val ftsQuery: String,
)

/** Mirrors `MedicationLookupPlan` (packages/search-lexical/src/medication-lookup.ts). */
data class MedicationSpellingInfo(val subject: String, val withoutSpelling: LookupQueryPlan)

data class MedicationLookupPlan(
    val branches: List<LexicalQueryBranchPlan>,
    val aliasMatches: List<String>,
    val terms: List<String>,
    val ftsQuery: String,
    val warnings: List<String>,
    val medicationSpellingNames: List<String>?,
    val medicationSpelling: MedicationSpellingInfo?,
)
