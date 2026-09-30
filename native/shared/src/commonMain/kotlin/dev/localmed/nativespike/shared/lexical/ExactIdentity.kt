package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.model.HydratedHit
import dev.localmed.nativespike.shared.model.RankedResult
import dev.localmed.nativespike.shared.text.buildQueryAlignedSnippet

/** Exact identities first use query-matching passages, then the first readable section. */
fun buildExactIdentityResults(db: NativeSearchDatabase, documentIds: Set<String>, terms: List<String>, ftsQueries: List<String>): List<RankedResult> {
    if (documentIds.isEmpty()) return emptyList()
    val found = linkedMapOf<String, HydratedHit>()
    for (ftsQuery in ftsQueries) {
        val remaining = documentIds - found.keys
        if (remaining.isEmpty()) break
        val hits = db.searchBranch(ftsQuery, minOf(500, remaining.size * 8), remaining.toList())
        val hydrated = db.hydrateHits(hits.map { it.chunkId }).associateBy { it.chunkId }
        for (hit in hits) hydrated[hit.chunkId]?.let { if (it.documentId !in found) found[it.documentId] = it }
    }
    return documentIds.mapNotNull { documentId ->
        val hit = found[documentId] ?: db.firstReadableChunk(documentId) ?: return@mapNotNull null
        val matches = matchedTerms(hit, terms)
        val excerpt = buildQueryAlignedSnippet(hit.originalText, matches.ifEmpty { terms })
        RankedResult(
            chunkId = hit.chunkId,
            documentId = hit.documentId,
            sourceType = hit.sourceType,
            documentTitle = hit.documentTitle,
            sectionType = hit.sectionType,
            category = resultCategory(hit.sectionType),
            sectionPath = hit.sectionPath,
            matchedTerms = matches,
            finalScore = 1.0,
            anchor = hit.anchor,
            sectionId = hit.sectionId,
            documentVersionId = hit.documentVersionId,
            snippet = excerpt.text,
            highlightedRanges = excerpt.ranges,
        )
    }
}

/** Mirrors `mergeExactIdentityResults`: keeps the ranked results, adding an exact result only for a
 * chunk id not already present. */
fun mergeExactIdentityResults(rankedResults: List<RankedResult>, exactResults: List<RankedResult>): List<RankedResult> {
    if (exactResults.isEmpty()) return rankedResults
    val byChunk = LinkedHashMap<String, RankedResult>()
    for (result in rankedResults) byChunk[result.chunkId] = result
    for (result in exactResults) if (result.chunkId !in byChunk) byChunk[result.chunkId] = result
    return byChunk.values.toList()
}
