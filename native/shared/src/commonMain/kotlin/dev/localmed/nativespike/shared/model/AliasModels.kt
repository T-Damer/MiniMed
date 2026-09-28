package dev.localmed.nativespike.shared.model

/**
 * Mirrors `TextRange` (packages/contracts/src/search.ts): a half-open `[start, end)` character
 * span in some `normalizedQuery`-coordinate string.
 */
data class TextRange(val start: Int, val end: Int)

/**
 * Mirrors `AliasRecord` (packages/domain/src/records.ts) — one row of the `aliases` table:
 * `id, canonical_term, alias, category, weight`.
 */
data class AliasRecord(
    val id: String,
    val canonicalTerm: String,
    val alias: String,
    val category: String?,
    val weight: Double,
)

/** Mirrors `AliasMatchType` (packages/search-lexical/src/aliases.ts). */
enum class AliasMatchType { EXACT, FUZZY }

/** Mirrors `AliasMatchSpan` (aliases.ts). */
data class AliasMatchSpan(
    val alias: AliasRecord,
    val range: TextRange,
    val matchType: AliasMatchType,
)

/** Mirrors `AliasExpansion` (aliases.ts). */
data class AliasExpansion(
    val terms: List<String>,
    /** `"<alias> → <canonicalTerm>"` strings, in the same format as the real search diagnostics'
     * `aliasMatches` field (see `create-medical-core.ts`) — this is the field
     * `export-search-golden.ts` records verbatim, so it is what the golden-parity test compares
     * against. */
    val matches: List<String>,
    val matchedAliases: List<AliasRecord>,
    val matchSpans: List<AliasMatchSpan>,
)
