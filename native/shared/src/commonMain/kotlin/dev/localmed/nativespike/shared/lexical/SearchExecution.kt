package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.model.BranchHit
import dev.localmed.nativespike.shared.model.ExactSubjectHitText
import dev.localmed.nativespike.shared.model.MedicationLookupPlan
import dev.localmed.nativespike.shared.text.isTokenChar
import dev.localmed.nativespike.shared.text.normalizeSurfaceText

/**
 * A Kotlin port of the SQL-execution layer stage 2 sub-stage C targets (docs/CURRENT_STATE.md):
 * `SqliteMedicalStore.search()`/`CapacitorMedicalStore.search()`'s bm25-ranking two-phase pattern
 * (`db/NativeSearchDatabase.kt`'s `searchBranch`, this file's `executeBranch`), and
 * `create-medical-core.ts`'s `hitsContainExactSubject`/`perBranchLimit` — the SQL-dependent check
 * that decides whether a sub-stage B medication-spelling suggestion is kept or reverted (deferred
 * there, resolved here).
 *
 * NOT ported: the full two-phase rowid-window -> hydration JOIN both TS stores use. Their second
 * phase (re-querying `chunks`/`sections`/`documents` by id and re-sorting into the first phase's
 * order) exists to build a complete `LexicalHit` — chunk/section/document records plus post-filter
 * checks — for the *caller* (fusion/grouping, sub-stage D). `export-search-golden.ts`'s `topHits`
 * (this sub-stage's parity target) only records `{chunkId, rank, position}` from that same
 * `store.search()` call with no filters (`filters: {}` always), so the first phase's own
 * bm25-ranked order already *is* the final order — a second hydration JOIN would reproduce the same
 * `chunkId`/order, just carrying data this parity check doesn't compare. `textsForChunks`
 * (`NativeSearchDatabase`) is a separate, narrower hydration used only by `hitsContainExactSubject`
 * below, which needs real chunk text.
 */

/** Mirrors `exactWords` (create-medical-core.ts): every run of letters/digits in the normalized
 * text — no stop-word or length filtering, unlike `tokenize()`. */
fun exactWords(text: String): List<String> {
    val normalized = normalizeSurfaceText(text)
    val words = mutableListOf<String>()
    var start = -1
    for (i in normalized.indices) {
        if (isTokenChar(normalized[i])) {
            if (start < 0) start = i
        } else if (start >= 0) {
            words.add(normalized.substring(start, i))
            start = -1
        }
    }
    if (start >= 0) words.add(normalized.substring(start))
    return words
}

/** Mirrors `hitsContainExactSubject`: true when one retrieved source passage literally contains
 * every word of the typed subject. */
fun hitsContainExactSubject(hits: List<ExactSubjectHitText>, subject: String): Boolean {
    val wanted = exactWords(subject)
    if (wanted.isEmpty()) return false
    return hits.any { hit ->
        val words = HashSet<String>()
        words.addAll(exactWords(hit.documentTitle))
        words.addAll(exactWords(hit.sectionTitle))
        words.addAll(exactWords(hit.originalText))
        wanted.all { it in words }
    }
}

/** Mirrors `const perBranchLimit = Math.max(parsed.data.limit * 5, 50);` (create-medical-core.ts). */
fun perBranchLimit(searchLimit: Int): Int = maxOf(searchLimit * 5, 50)

/** Runs one branch's exact `ftsQuery` against the real store — the same call
 * `create-medical-core.ts`'s `runBranchSearches` makes internally, and what
 * `export-search-golden.ts` re-runs directly per branch for `topHits`. */
fun executeBranch(db: NativeSearchDatabase, ftsQuery: String, limit: Int): List<BranchHit> =
    db.searchBranch(ftsQuery, limit)

/**
 * Mirrors the `hitsContainExactSubject` gate in `create-medical-core.ts`'s `search()`: if a
 * medication-spelling plan exists, execute its BASE (without-spelling) branches at
 * `perBranchLimit(searchLimit)` and check whether the typed subject already appears verbatim in
 * those hits' text. If so, the typed word is not a misspelling here — revert to the plan without
 * the spelling suggestion, exactly like `plan = spelling.withoutSpelling` does in the TS source.
 * Otherwise keep `plan` as sub-stage B built it.
 */
fun resolveMedicationSpellingPlan(
    plan: MedicationLookupPlan,
    db: NativeSearchDatabase,
    searchLimit: Int,
): MedicationLookupPlan {
    val spelling = plan.medicationSpelling ?: return plan
    val baseBranches = spelling.withoutSpelling.branches
    val limit = perBranchLimit(searchLimit)
    val baseChunkIds = baseBranches.flatMap { branch -> executeBranch(db, branch.ftsQuery, limit) }
        .map { it.chunkId }
        .distinct()
    val texts = db.textsForChunks(baseChunkIds)
    return if (hitsContainExactSubject(texts, spelling.subject)) {
        val base = spelling.withoutSpelling
        MedicationLookupPlan(
            branches = base.branches,
            aliasMatches = base.aliasMatches,
            terms = base.terms,
            ftsQuery = base.ftsQuery,
            warnings = emptyList(),
            medicationSpellingNames = null,
            medicationSpelling = null,
        )
    } else {
        plan
    }
}
