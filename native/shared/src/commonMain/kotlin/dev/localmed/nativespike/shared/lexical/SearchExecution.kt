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
 * (sub-stage C's parity target) only records `{chunkId, rank, position}` from that same
 * `store.search()` call with no filters (`filters: {}` always), so the first phase's own
 * bm25-ranked order already *is* the final order — a second hydration JOIN would reproduce the same
 * `chunkId`/order, just carrying data this parity check doesn't compare. `textsForChunks`
 * (`NativeSearchDatabase`) is a separate, narrower hydration used only by `hitsContainExactSubject`
 * below, which needs real chunk text.
 *
 * IMPORTANT correction found during stage 2 sub-stage D (fusion/grouping): `create-medical-core.ts`
 * never calls `SqliteMedicalStore`/`CapacitorMedicalStore.search()` directly — `options.store` is a
 * `MultiMedicalStore` (packages/storage/src/multi-medical-store.ts), and `MultiMedicalStore.search()`
 * REPLACES each hit's `rank` with a reciprocal-rank-fusion value —
 * `mount.searchWeight / (60 + index + 1)` (`DEFAULT_RRF_K = 60`) — computed purely from that hit's
 * POSITION in the underlying store's bm25-ordered list, discarding the bm25 magnitude entirely
 * except to establish that order. `executeBranch` below applies this transform, matching what every
 * caller in `create-medical-core.ts` (`runBranchSearches`) and `export-search-golden.ts` (which
 * calls `store.search()` on the `MultiMedicalStore` itself, not a raw single-pack store) actually
 * sees. `--corpus=core` mounts exactly one store, `'minimed.core.ru'`, whose `searchWeight = 1.1` is
 * hardcoded in `tools/benchmarks/src/real-corpus.ts` — the exact value `search-golden.json` was
 * generated with, so it is hardcoded here too rather than threaded through as a parameter this
 * migration never needs a second value for. Found by comparing this port's `bestScore` against
 * golden's: a query with only one branch (no corroboration to mask the difference) showed a
 * consistent, non-trivial `finalScore` gap despite an *exactly* matching `chunkId` order — tracing
 * that gap to its source (not just re-deriving the RRF formula) is what surfaced this file.
 * `db/NativeSearchDatabase.kt`'s `searchBranch` (sub-stage C) is intentionally left returning the
 * single-store bm25-transform rank unchanged — it faithfully mirrors
 * `SqliteMedicalStore`/`CapacitorMedicalStore.search()` on their own terms, which is still the
 * correct comparison target for sub-stage C's own golden field (`topHits`, captured the same way);
 * this file's `executeBranch` is where the *additional* `MultiMedicalStore` layer is applied on top,
 * for every caller from sub-stage D onward.
 */

private const val CORE_MOUNT_SEARCH_WEIGHT = 1.1
private const val RECIPROCAL_RANK_FUSION_K = 60

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

/**
 * Runs one branch's exact `ftsQuery` against the real store — the same call
 * `create-medical-core.ts`'s `runBranchSearches` makes internally, and what
 * `export-search-golden.ts` re-runs directly per branch — THEN applies `MultiMedicalStore.search()`'s
 * reciprocal-rank-fusion re-ranking (see this file's header), since both of those real callers go
 * through `MultiMedicalStore`, not the raw single-pack store. `db.searchBranch`'s own bm25-order is
 * preserved (RRF is a strictly monotonic function of position), only the `rank` *value* changes.
 */
fun executeBranch(db: NativeSearchDatabase, ftsQuery: String, limit: Int): List<BranchHit> =
    db.searchBranch(ftsQuery, limit).mapIndexed { index, hit ->
        hit.copy(rank = CORE_MOUNT_SEARCH_WEIGHT / (RECIPROCAL_RANK_FUSION_K + index + 1))
    }

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
    onStage: ((String, Double) -> Unit)? = null,
): MedicationLookupPlan {
    val spelling = plan.medicationSpelling ?: return plan
    val baseBranches = spelling.withoutSpelling.branches
    val limit = perBranchLimit(searchLimit)
    val baseChunkIds = timedStage(onStage, "sql") {
        baseBranches.flatMap { branch -> executeBranch(db, branch.ftsQuery, limit) }
    }
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
