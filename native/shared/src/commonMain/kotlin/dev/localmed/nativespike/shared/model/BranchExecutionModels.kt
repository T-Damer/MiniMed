package dev.localmed.nativespike.shared.model

/**
 * One row of the bm25-ranked candidate window `NativeSearchDatabase.searchBranch` returns —
 * mirrors the `{chunkId, rank}` pair `SqliteMedicalStore.search()`/`CapacitorMedicalStore.search()`
 * (packages/storage-sqlite, packages/storage-capacitor) produce per hit, in final rank order.
 * `rank`: `rawBm25 < 0 ? -rawBm25 : 1 / (1 + rawBm25)` — the same transform both TS stores apply.
 */
data class BranchHit(val chunkId: String, val rank: Double,val mountId: String? = null)

/** The document/section/chunk text `hitsContainExactSubject` (create-medical-core.ts) reads —
 * deliberately narrower than a full hydrated hit (no metadata/anchors/etc — nothing else that
 * check touches). */
data class ExactSubjectHitText(
    val documentTitle: String,
    val sectionTitle: String,
    val originalText: String,
    val chunkId: String? = null,
)
