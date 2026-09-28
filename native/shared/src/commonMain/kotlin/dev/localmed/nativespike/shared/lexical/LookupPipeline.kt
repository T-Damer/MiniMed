package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.model.AliasRecord
import dev.localmed.nativespike.shared.model.DocumentDescriptor
import dev.localmed.nativespike.shared.model.HydratedHit
import dev.localmed.nativespike.shared.model.RankedGroup
import dev.localmed.nativespike.shared.text.normalizeSurfaceText

/**
 * The end-to-end stage 2 sub-stage D orchestration (docs/CURRENT_STATE.md): ties together the
 * lookup plan (sub-stage B), SQL branch execution (sub-stage C), and fusion/grouping/ranking (this
 * sub-stage) into the same sequence `create-medical-core.ts`'s `search()` +
 * `ScopedMedicalCore.search()` run, for `scope: 'all'`, `mode: 'lexical'`, `analysisMode: 'lookup'`
 * — exactly what `export-search-golden.ts` calls (`ScopedMedicalCore`, not `MedicalCore` directly,
 * which is why the `documentKind`/`contentKind` tagging and audience/strict-identity re-sort are
 * included below, not just the `packages/core` pieces).
 *
 * Deliberately NOT ported for this pipeline (each is its own documented scope cut in the file it
 * would have lived in, repeated here as the single list of what's missing end-to-end):
 *  - `QueryDocumentIndex`-based exact-identity results (`buildExactIdentityResults`,
 *    `mergeExactIdentityResults`, `exactAliasIds`/`exactTitleIds`/`exactNavigationAliasIds`/
 *    `exactShortTitleIds`) — a document that ISN'T surfaced by any branch's own FTS search can
 *    never appear in this port's groups, even if its title/alias exactly names the query. Also
 *    means `fuseBranchHits`'s `exactAliasDocumentIds` parameter is always empty here.
 *  - terminology matching (`TerminologySearchIndex`/`termIndex.match`/`.rank`) — explicitly out of
 *    scope for stage 2 (docs/CURRENT_STATE.md); `terminologyMatch` is always treated as absent.
 *  - semantic/vector search (`fuseSemanticResults`) — never reached: `export-search-golden.ts`
 *    always requests `mode: 'lexical'`.
 *  - `selectedGroupPresentation` (medication trade-name title prefix) — display-only, does not
 *    change `bestScore`/order/`documentKind`/`contentKind` (see `Grouping.kt`'s header).
 *  - `hasImmediateFailureContext`/`hasDelayedMedicationFailureContext` inside `titleTermBoost` —
 *    see `QueryGroupRanking.kt`'s header.
 *  - `keepExplicitMedicationMatches`/document-id scope filtering/`rankDiagnosisGroups` — all
 *    unreachable for `scope: 'all'` (see `ScopedRanking.kt`'s header).
 */

private fun toDocumentDescriptor(hit: HydratedHit): DocumentDescriptor = DocumentDescriptor(
    id = hit.documentId,
    sourceType = hit.sourceType,
    title = hit.documentTitle,
    catalogFamily = hit.catalogFamily,
    entityType = hit.entityType,
    targetDocumentId = hit.targetDocumentId,
    contentMode = hit.contentMode,
    notLegalAdvice = hit.notLegalAdvice,
    interactiveAssessmentId = hit.interactiveAssessmentId,
    calculationRequired = hit.calculationRequired,
    interactiveCalculatorId = hit.interactiveCalculatorId,
    navigationAliases = hit.navigationAliases,
    ageGroups = hit.ageGroups,
)

private fun executeAndHydrateBranch(db: NativeSearchDatabase, branch: dev.localmed.nativespike.shared.model.LexicalQueryBranchPlan, limit: Int): BranchExecutionResult {
    val branchHits = executeBranch(db, branch.ftsQuery, limit)
    val rankByChunk = branchHits.associate { it.chunkId to it.rank }
    val hydratedByChunk = db.hydrateHits(branchHits.map { it.chunkId }).associateBy { it.chunkId }
    val orderedHits = branchHits.mapNotNull { bh ->
        hydratedByChunk[bh.chunkId]?.copy(rank = rankByChunk.getValue(bh.chunkId))
    }
    return BranchExecutionResult(branch, orderedHits)
}

/**
 * Mirrors `real-corpus.ts`'s `target()` — the benchmark-only helper `export-search-golden.ts` uses
 * to compute `targetDocumentId` for its own reporting. Deliberately NOT the same function as
 * `resolvedGroupIdentity` (`QueryGroupRanking.kt`): `target()` unconditionally reads
 * `metadata.targetDocumentId` when present, with no `sourceType`/`catalogFamily` gate —
 * `resolvedGroupIdentity` is the pipeline's own internal dedup key (used by
 * `collapseGroupsByTargetDocument` during ranking); `target()` only exists for golden's own
 * post-hoc column, applied to whatever `documentId` the search already returned.
 */
private fun resolveTargetDocumentId(documentId: String, documentsById: Map<String, DocumentDescriptor>): String {
    val pointed = documentsById[documentId]?.targetDocumentId
    return if (!pointed.isNullOrBlank()) pointed else documentId
}

/** The full pipeline's result — the fields `search-golden.json`'s `groups` array records. */
data class LookupGroupSummary(
    val documentId: String,
    val targetDocumentId: String,
    val documentKind: String?,
    val contentKind: String?,
    val bestScore: Double,
)

/**
 * Runs one query through the full stage 2 sub-stage D pipeline and returns the top-`groupLimit`
 * groups, in final order — directly comparable to `search-golden.json`'s `queries[].groups`.
 */
fun runLookupPipeline(query: String, aliases: List<AliasRecord>, db: NativeSearchDatabase, groupLimit: Int): List<LookupGroupSummary> {
    val builtPlan = buildLookupQueryPlan(query, aliases)
    val plan = resolveMedicationSpellingPlan(builtPlan, db, groupLimit)
    val limit = perBranchLimit(groupLimit)

    val branchResults = plan.branches.map { branch -> executeAndHydrateBranch(db, branch, limit) }
    val allHits = branchResults.flatMap { it.hits }
    val documentsById = LinkedHashMap<String, DocumentDescriptor>()
    for (hit in allHits) documentsById.getOrPut(hit.documentId) { toDocumentDescriptor(hit) }

    val fused = fuseBranchHits(branchResults, limit, query, emptySet())
    val availableDocumentIds = db.allDocumentIds().toSet()
    val results = filterSupersededSummaryResults(fused, availableDocumentIds)

    val normalizedQuery = normalizeSurfaceText(query)
    val preferredSectionType = requestedSectionType(normalizedQuery)
    var groups: List<RankedGroup> = groupResults(results, preferredSectionType)
    groups = rankSearchGroupsByQuery(groups, query, documentsById)
    groups = filterSuffixFallbackGroups(groups, query, aliases)
    groups = collapseGroupsByTargetDocument(groups, documentsById)
    groups = groups.take(groupLimit)

    // apps/app's ScopedMedicalCore layer (scope 'all') — see file header.
    groups = filterMedicationDocuments(groups, query, documentsById)
    val requestedAudience = inferRequestedAudience(query)
    groups = rankSearchGroupsByAudience(groups, documentsById, requestedAudience)
    if (requestedAudience != null) groups = preferClinicalRecommendationForCaseQueries(groups)
    groups = preserveStrictIdentities(groups, query, documentsById)
    groups = groups.map { it.copy(contentKind = searchResultContentKind(documentsById[it.documentId])) }

    return groups.map { group ->
        LookupGroupSummary(
            documentId = group.documentId,
            targetDocumentId = resolveTargetDocumentId(group.documentId, documentsById),
            documentKind = group.documentKind,
            contentKind = group.contentKind,
            bestScore = group.bestScore,
        )
    }
}
