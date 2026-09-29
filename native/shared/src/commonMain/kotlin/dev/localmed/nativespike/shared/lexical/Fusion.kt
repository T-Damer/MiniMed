package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.HydratedHit
import dev.localmed.nativespike.shared.model.LexicalQueryBranchPlan
import dev.localmed.nativespike.shared.model.QueryBranchKind
import dev.localmed.nativespike.shared.model.RankedResult
import dev.localmed.nativespike.shared.text.normalizeSurfaceText
import dev.localmed.nativespike.shared.text.searchSubjectText

/**
 * A Kotlin port of `fuseBranchHits` and its immediate helpers (packages/core/src/create-medical-core.ts)
 * — stage 2 sub-stage D of the migration (docs/CURRENT_STATE.md). Combines one query's per-branch
 * SQL hits into a single per-chunk ranked list.
 *
 * NOT ported: real snippet building (`buildQueryAlignedSnippet`/`presentationRowTerms`/`buildSnippet`)
 * and `conceptIdFromMetadata`/`terminologyConceptIds` filtering — display-only fields that do not
 * feed `finalScore`, group order, `documentKind`, or `contentKind` (this migration's only compared
 * fields; verified by reading every consumer of `SearchResult` in `create-medical-core.ts` and
 * `query-group-ranking.ts`). `matchedTerms` IS ported (below) because `groupRankingText`
 * (`QueryGroupRanking.kt`) folds it into the text `queryGroupRelevanceBoost` scores — it is
 * computed the same way the TS source does (title + section path + chunk original text), just
 * without ever materializing a truncated/highlighted snippet string.
 */

/** Mirrors `matchedTerms`. */
fun matchedTerms(hit: HydratedHit, terms: List<String>): List<String> {
    val haystack = normalizeSurfaceText("${hit.documentTitle} ${hit.sectionPath.joinToString(" ")} ${hit.originalText}")
    return terms.filter { haystack.contains(normalizeSurfaceText(it)) }
}

/** Mirrors `resultCategory`. */
fun resultCategory(sectionType: String?): String = when (sectionType) {
    "definition", "classification" -> "overview"
    "clinical-picture" -> "clinical-picture"
    "differential-diagnosis" -> "differential-diagnosis"
    "diagnostics" -> "diagnostics"
    "treatment" -> "treatment"
    "routing" -> "routing"
    "rehabilitation", "follow-up", "prevention" -> "follow-up"
    else -> "other"
}

/** Mirrors `branchSectionBoost`. */
fun branchSectionBoost(branch: LexicalQueryBranchPlan, hit: HydratedHit): Double {
    val titleTokens = normalizeSurfaceText(hit.documentTitle).split(' ')
    val titleBoost = if (
        branch.terms.any { term ->
            term.length >= 4 && titleTokens.any { it.startsWith(normalizeSurfaceText(term)) }
        }
    ) {
        0.3
    } else {
        0.0
    }
    val sectionType = hit.sectionType
    return when {
        branch.kind == QueryBranchKind.INVESTIGATION && sectionType == "diagnostics" -> titleBoost + 0.03
        branch.kind == QueryBranchKind.MEDICATION && sectionType == "treatment" -> titleBoost + 0.03
        branch.kind == QueryBranchKind.CLINICAL &&
            (sectionType == "clinical-picture" || sectionType == "differential-diagnosis") -> titleBoost + 0.025
        else -> titleBoost
    }
}

private class BranchContribution(val branchId: String, val score: Double)

private class AggregatedHit(
    var hit: HydratedHit,
    val branchIds: MutableSet<String> = LinkedHashSet(),
    val terms: MutableSet<String> = LinkedHashSet(),
    val branchContributions: MutableList<BranchContribution> = mutableListOf(),
    var sectionBoost: Double = 0.0,
    var score: Double = 0.0,
    var bestLexicalScore: Double = 0.0,
)

/** UI-display-only truncation — see `RankedResult.previewText`'s doc for why this isn't a real
 * snippet port. */
private const val PREVIEW_TEXT_LENGTH = 240

internal fun previewText(originalText: String): String =
    if (originalText.length <= PREVIEW_TEXT_LENGTH) originalText else originalText.take(PREVIEW_TEXT_LENGTH) + "…"

private fun toRankedResult(aggregate: AggregatedHit): RankedResult {
    val terms = aggregate.terms.toList()
    val matches = matchedTerms(aggregate.hit, terms)
    return RankedResult(
        chunkId = aggregate.hit.chunkId,
        documentId = aggregate.hit.documentId,
        sourceType = aggregate.hit.sourceType,
        documentTitle = aggregate.hit.documentTitle,
        sectionType = aggregate.hit.sectionType,
        category = resultCategory(aggregate.hit.sectionType),
        sectionPath = aggregate.hit.sectionPath,
        matchedTerms = matches,
        finalScore = aggregate.score,
        anchor = aggregate.hit.anchor,
        sectionId = aggregate.hit.sectionId,
        previewText = previewText(aggregate.hit.originalText),
    )
}

/** One branch's plan plus the hydrated hits its `ftsQuery` produced, in bm25-rank order — the
 * input shape `fuseBranchHits` takes. */
data class BranchExecutionResult(val branch: LexicalQueryBranchPlan, val hits: List<HydratedHit>)

/**
 * Mirrors `fuseBranchHits`. `exactAliasDocumentIds`: documents whose hits must survive the `limit`
 * cutoff even when they rank below it (the real pipeline sources this from `QueryDocumentIndex`,
 * not ported here — see `LookupPipeline.kt`'s header for why; this port always passes an empty set,
 * a documented, honest simplification, not a silent behavior change disguised as a default).
 */
fun fuseBranchHits(
    branchHits: List<BranchExecutionResult>,
    limit: Int,
    query: String,
    exactAliasDocumentIds: Set<String>,
): List<RankedResult> {
    val aggregateByChunk = LinkedHashMap<String, AggregatedHit>()

    for ((branch, hits) in branchHits) {
        val strongestLexicalScore = maxOf(0.000_001, hits.maxOfOrNull { it.rank } ?: 0.0)
        for ((index, hit) in hits.withIndex()) {
            val existing = aggregateByChunk.getOrPut(hit.chunkId) { AggregatedHit(hit = hit) }
            val relativeLexicalScore = maxOf(0.0, hit.rank) / strongestLexicalScore
            val rankPositionSignal = 1.0 / (index + 1)
            val branchScore = branch.weight * (relativeLexicalScore * 0.82 + rankPositionSignal * 0.18)

            existing.branchContributions.add(BranchContribution(branch.id, branchScore))
            existing.sectionBoost = maxOf(existing.sectionBoost, branchSectionBoost(branch, hit))
            existing.bestLexicalScore = maxOf(existing.bestLexicalScore, hit.rank)
            existing.branchIds.add(branch.id)
            existing.terms.addAll(branch.terms)
        }
    }

    for (aggregate in aggregateByChunk.values) {
        val sortedContributions = aggregate.branchContributions.sortedByDescending { it.score }
        val strongest = sortedContributions.firstOrNull()
        val supporting = sortedContributions.drop(1)
        val strongestScore = strongest?.score ?: 0.0
        val corroboratingScores = supporting
            .filter { it.branchId != DILUTED_DIAGNOSIS_ALIAS_BRANCH_ID }
            .map { it.score }
        val corroboration = minOf(
            strongestScore * 0.28,
            corroboratingScores.sumOf { minOf(it, strongestScore) * 0.1 },
        )
        aggregate.score = strongestScore + corroboration + aggregate.sectionBoost
    }

    val subject = searchSubjectText(query)
    return aggregateByChunk.values
        .sortedByDescending { it.score }
        .filterIndexed { index, aggregate ->
            index < limit ||
                exactAliasDocumentIds.contains(aggregate.hit.documentId) ||
                normalizeSurfaceText(aggregate.hit.documentTitle) == subject
        }
        .map(::toRankedResult)
}
