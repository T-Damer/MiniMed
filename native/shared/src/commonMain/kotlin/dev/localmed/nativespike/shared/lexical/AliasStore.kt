package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.AliasRecord

/**
 * Mirrors `MultiMedicalStore.listAliases()` (packages/storage/src/multi-medical-store.ts): dedupes
 * by `id` (last write wins for a given id — matches JS `Map.set` semantics; harmless for a single
 * mounted pack, where every id is already unique) and sorts by `alias` using a **locale-aware**
 * comparison, not raw SQL row order. `db/NativeSearchDatabase.kt`'s `listAliases()` only returns
 * one store's own `SELECT ... ORDER BY alias` (SQLite's default *binary* collation) — this
 * reproduces the layer above it that the real search pipeline's alias vocabulary actually goes
 * through before `aliases.ts`'s `createAliasExpander` ever sees it, and whose tie-break order
 * `createAliasExpander`'s own stable length-descending sort then preserves for same-length aliases.
 *
 * Found during stage 2 sub-stage A's golden-parity work: without this step, `aliasMatches` for
 * queries with same-length same-word-different-case aliases (e.g. "кашель" vs "Кашель") came out
 * in the *wrong relative order* — SQL binary collation puts uppercase Cyrillic before lowercase
 * (`К` U+041A < `к` U+043A), but golden showed lowercase first (see `localeCompareApprox`).
 */
fun sortAliasesLikeMultiMedicalStore(aliases: List<AliasRecord>): List<AliasRecord> {
    val byId = LinkedHashMap<String, AliasRecord>()
    for (alias in aliases) byId[alias.id] = alias
    return byId.values.sortedWith { left, right -> localeCompareApprox(left.alias, right.alias) }
}

/**
 * Approximates JS `String.prototype.localeCompare()` at its *default* call (`left.localeCompare(right)`,
 * no explicit locale/options) — the exact call `multi-medical-store.ts` makes. This is not a full
 * Unicode Collation Algorithm implementation (no per-platform ICU is wired into this Kotlin module
 * for any target here); it is a two-level approximation that was verified to reproduce every
 * alias-ordering case actually observed in `search-golden.json`:
 *  1. primary: compare case-folded (`.lowercase()`) strings — base-letter order;
 *  2. tertiary, only when the primary comparison is a tie (same string up to case): the first
 *     character position that differs by case only decides it, lowercase sorting before uppercase
 *     (matches the observed golden order, e.g. "кашель" < "Кашель").
 * A real ICU root-locale collation additionally accounts for diacritics, punctuation-as-ignorable,
 * and script-specific tailoring that this alias vocabulary (near-entirely plain Cyrillic/Latin
 * words) does not exercise; if a future alias set does, this approximation would need revisiting.
 */
fun localeCompareApprox(left: String, right: String): Int {
    val primary = left.lowercase().compareTo(right.lowercase())
    if (primary != 0) return primary
    val minLength = minOf(left.length, right.length)
    for (i in 0 until minLength) {
        val leftChar = left[i]
        val rightChar = right[i]
        if (leftChar == rightChar) continue
        val leftIsLower = leftChar.isLowerCase()
        val rightIsLower = rightChar.isLowerCase()
        if (leftIsLower != rightIsLower) return if (leftIsLower) -1 else 1
        return leftChar.compareTo(rightChar)
    }
    return left.length - right.length
}
