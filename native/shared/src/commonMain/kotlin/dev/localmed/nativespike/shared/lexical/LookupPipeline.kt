package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.model.AliasRecord
import dev.localmed.nativespike.shared.model.DocumentDescriptor
import dev.localmed.nativespike.shared.model.HydratedHit
import dev.localmed.nativespike.shared.model.RankedGroup
import dev.localmed.nativespike.shared.model.RankedResult
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
 * `QueryDocumentIndex` (`buildExactIdentityResults`/`mergeExactIdentityResults`/
 * `exactAliasIds`/`exactTitleIds`/`exactNavigationAliasIds`/`exactShortTitleIds`) IS now ported
 * (post-sub-stage-D-report revision, per the coordinator): a document an exact alias/title/
 * navigation-alias names, that no branch's own FTS search happened to surface, is now added to
 * results the same way `create-medical-core.ts` does, and `fuseBranchHits`'s `exactAliasDocumentIds`
 * cutoff-survival parameter is real, not an empty placeholder. The caller builds one
 * `QueryDocumentIndex` ONCE (`buildQueryDocumentIndex`, from `NativeSearchDatabase.listSearchDocuments()`)
 * and passes it into every `runLookupPipeline` call — mirroring `create-medical-core.ts` caching
 * `queryDocumentIndex` across searches. (Optimization pass correction: `create-medical-core.ts`
 * builds this lazily inside the first `search()` call, not at WebView startup — see
 * `QueryDocumentIndex.kt`'s header. `LookupEngine.kt` builds it in the background after
 * construction, which starts earlier than TS's own lazy trigger without blocking first frame.)
 *
 * Still deliberately NOT ported for this pipeline (each is its own documented scope cut in the file
 * it would have lived in, repeated here as the single list of what's missing end-to-end):
 *  - terminology matching (`TerminologySearchIndex`/`termIndex.match`/`.rank`) — explicitly out of
 *    scope for stage 2 (docs/CURRENT_STATE.md); `terminologyMatch` is always treated as absent, so
 *    `termIndex.rank(groupedResults, terminologyMatch)` is treated as an identity passthrough (its
 *    only other job — reordering by terminology relevance — needs a real terminology match, which
 *    never happens here).
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

private fun executeAndHydrateBranch(
    db: NativeSearchDatabase,
    branch: dev.localmed.nativespike.shared.model.LexicalQueryBranchPlan,
    limit: Int,
    onStage: ((String, Double) -> Unit)? = null,
): BranchExecutionResult {
    val branchHits = timedStage(onStage, "sql") { executeBranch(db, branch.ftsQuery, limit) }
    val rankByChunk = branchHits.associate { it.chunkId to it.rank }
    val hydratedByChunk = timedStage(onStage, "hydration") { db.hydrateHits(branchHits.map { it.chunkId }) }
        .associateBy { it.chunkId }
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
 * Builds the `QueryDocumentIndex` once from the whole corpus (`NativeSearchDatabase.listSearchDocuments()`)
 * — call this once per DB open (mirrors `create-medical-core.ts` building/caching `queryDocumentIndex`
 * once), not per query. Exposed separately (not hidden inside `runLookupPipeline`) so stage 4's UI
 * wiring can time it explicitly as part of cold start, the same way the real WebView pipeline's
 * equivalent startup cost is measured.
 */
fun buildQueryDocumentIndex(db: NativeSearchDatabase): QueryDocumentIndex =
    QueryDocumentIndex(db.listSearchDocuments())

/**
 * Runs one query through the full stage 2 sub-stage D pipeline and returns the top-`groupLimit`
 * groups, in final order, WITH full per-result data (title, snippet preview, anchors) — the shape
 * stage 4's UI wiring needs. `runLookupPipeline` (below) is a thin wrapper over this for the
 * golden-parity tests, which only need the narrower `LookupGroupSummary` fields.
 * `documentIndex` should be built once (`buildQueryDocumentIndex`) and reused across queries.
 *
 * **Optimization pass** (docs/research/native-vs-webview-2026-09-28.md, "Optimization pass"):
 * `aliasExpander`/`medicationMatcher` are now optional pre-built vocabulary structures (from
 * `createAliasExpander`/`createMedicationSpellingMatcher`, built ONCE by `LookupEngine`) — passing
 * them avoids rebuilding the alias fuzzy-match head index and the medication-spelling index on
 * every single query, which profiling (see the doc's stage-timing table) found was the majority of
 * this pipeline's own cost. Omitting them preserves the exact old rebuild-per-call behavior (used
 * by golden-parity tests, which pass small/fresh alias lists where rebuilding is cheap and where
 * changing the test call sites was unnecessary risk for zero benefit). `onStage`, when non-null,
 * receives `(stageName, ms)` for every timed phase — see `PipelineTiming.kt`.
 */
fun runLookupPipelineGroups(
    query: String,
    aliases: List<AliasRecord>,
    db: NativeSearchDatabase,
    documentIndex: QueryDocumentIndex,
    groupLimit: Int,
    aliasExpander: AliasExpander? = null,
    medicationMatcher: MedicationSpellingMatcher? = null,
    onStage: ((String, Double) -> Unit)? = null,
): List<RankedGroup> {
    timedStage(onStage, "normalize") { normalizeSurfaceText(query) }
    val preparedExpansion = timedStage(onStage, "aliases") { aliasExpander?.expand(query) }
    val builtPlan = buildLookupQueryPlan(query, aliases, preparedExpansion, medicationMatcher, onStage)
    val plan = resolveMedicationSpellingPlan(builtPlan, db, groupLimit, onStage)
    val limit = perBranchLimit(groupLimit)

    val branchResults = plan.branches.map { branch -> executeAndHydrateBranch(db, branch, limit, onStage) }
    val allHits = branchResults.flatMap { it.hits }
    val documentsById = LinkedHashMap<String, DocumentDescriptor>()
    for (hit in allHits) documentsById.getOrPut(hit.documentId) { toDocumentDescriptor(hit) }

    val (exactAliasDocumentIds, exactTitleDocumentIds, exactNavigationAliasDocumentIds, exactShortTitleDocumentIds) =
        timedStage(onStage, "exactIdentity") {
            // Mirrors create-medical-core.ts's exact*DocumentIds (terminology's contribution to
            // exactAliasDocumentIds is always empty here — see file header).
            ExactIdentityIdSet(
                documentIndex.exactAliasIds(query),
                documentIndex.exactTitleIds(query),
                documentIndex.exactNavigationAliasIds(query),
                documentIndex.exactShortTitleIds(query),
            )
        }
    val exactSecondaryIdentityDocumentIds = exactNavigationAliasDocumentIds + exactShortTitleDocumentIds
    val exactIdentityDocumentIds = exactTitleDocumentIds + exactSecondaryIdentityDocumentIds
    val spellingDocumentIds = (plan.medicationSpellingNames ?: emptyList())
        .flatMap { name -> documentIndex.exactIdentityIds(name) }
        .distinct()
        .take(40)
        .toSet()

    val fused = timedStage(onStage, "fusion") { fuseBranchHits(branchResults, limit, query, exactAliasDocumentIds) }
    val retainedDocumentIds = fused.map { it.documentId }.toSet()

    fun addExactResults(documentIds: Set<String>): List<RankedResult> {
        val missing = documentIds - retainedDocumentIds
        if (missing.isEmpty()) return emptyList()
        val results = buildExactIdentityResults(db, missing, plan.terms)
        // Register newly-discovered documents (found only via exact identity, never via FTS) into
        // the descriptor map too, so downstream kind/target/ranking logic can see them.
        for (result in results) {
            if (result.documentId !in documentsById) {
                db.firstReadableChunk(result.documentId)?.let { documentsById[it.documentId] = toDocumentDescriptor(it) }
            }
        }
        return results
    }

    val (exactIdentityResults, spellingResults) = timedStage(onStage, "exactIdentity") {
        addExactResults(exactIdentityDocumentIds) to addExactResults(spellingDocumentIds)
    }
    val merged = mergeExactIdentityResults(fused, exactIdentityResults + spellingResults)
    val results = filterSupersededSummaryResults(merged, documentIndex.availableIds)

    val normalizedQuery = normalizeSurfaceText(query)
    val preferredSectionType = requestedSectionType(normalizedQuery)
    var groups: List<RankedGroup> = timedStage(onStage, "grouping") { groupResults(results, preferredSectionType) }
    groups = timedStage(onStage, "ranking") {
        var g = rankSearchGroupsByQuery(groups, query, documentsById)
        g = filterSuffixFallbackGroups(g, query, aliases, exactIdentityDocumentIds + spellingDocumentIds)
        // Mirrors `termIndex.rank(groupedResults, terminologyMatch).toSorted(exactTitle/exactSecondary/
        // spelling tie-break)` — `termIndex.rank(...)` is an identity passthrough here (no
        // terminology match, see file header), so only the tie-break sort applies. `sortedWith` is
        // stable, matching `.toSorted()`, so ties keep `rankSearchGroupsByQuery`'s own order.
        g = g.sortedWith(
            compareByDescending<RankedGroup> { it.documentId in exactTitleDocumentIds }
                .thenByDescending { it.documentId in exactSecondaryIdentityDocumentIds }
                .thenByDescending { it.documentId in spellingDocumentIds },
        )
        g = collapseGroupsByTargetDocument(g, documentsById)
        g = g.take(groupLimit)

        // apps/app's ScopedMedicalCore layer (scope 'all') — see file header.
        g = filterMedicationDocuments(g, query, documentsById)
        val requestedAudience = inferRequestedAudience(query)
        g = rankSearchGroupsByAudience(g, documentsById, requestedAudience)
        if (requestedAudience != null) g = preferClinicalRecommendationForCaseQueries(g)
        g = preserveStrictIdentities(g, query, documentsById)
        g.map {
            it.copy(
                contentKind = searchResultContentKind(documentsById[it.documentId]),
                targetDocumentId = resolveTargetDocumentId(it.documentId, documentsById),
            )
        }
    }

    return groups
}

private data class ExactIdentityIdSet(
    val alias: Set<String>,
    val title: Set<String>,
    val navigationAlias: Set<String>,
    val shortTitle: Set<String>,
)

/**
 * Thin wrapper over `runLookupPipelineGroups` for the golden-parity tests, which only compare
 * `documentId`/`targetDocumentId`/`documentKind`/`contentKind`/`bestScore` — see
 * `search-golden.json`'s `queries[].groups` shape.
 */
fun runLookupPipeline(
    query: String,
    aliases: List<AliasRecord>,
    db: NativeSearchDatabase,
    documentIndex: QueryDocumentIndex,
    groupLimit: Int,
    aliasExpander: AliasExpander? = null,
    medicationMatcher: MedicationSpellingMatcher? = null,
): List<LookupGroupSummary> =
    runLookupPipelineGroups(query, aliases, db, documentIndex, groupLimit, aliasExpander, medicationMatcher).map { group ->
        LookupGroupSummary(
            documentId = group.documentId,
            targetDocumentId = group.targetDocumentId,
            documentKind = group.documentKind,
            contentKind = group.contentKind,
            bestScore = group.bestScore,
        )
    }
