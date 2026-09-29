package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.model.RankedResult

/**
 * A Kotlin port of `buildExactIdentityResults`/`exactIdentityResult` (create-medical-core.ts) —
 * documents an exact title/navigation-alias/short-title (or, for a medication-spelling suggestion,
 * exact identity) match names, added to results even when no branch's own FTS search surfaced them.
 *
 * Simplified relative to the TS source: `exactIdentityResult` hardcodes `score: 1` (and
 * `bestLexicalScore: 1`) regardless of *which* chunk backs the result — so the TS source's first
 * attempt (re-running each base branch's `ftsQuery` restricted to just the missing document ids, to
 * find a chunk that actually matches the search terms) and its fallback (the document's first
 * non-blank chunk, read directly) produce the *same* `finalScore` either way; only the displayed
 * snippet/section would differ, which this port doesn't keep (see `Fusion.kt`'s header on why
 * `snippet` is dropped entirely). This port therefore always uses the fallback path
 * (`NativeSearchDatabase.firstReadableChunk`) — same `finalScore`, `documentId`, `sectionType` (and
 * therefore same `bestScore`/grouping/`documentKind` behavior downstream), fewer SQL round trips.
 */
fun buildExactIdentityResults(db: NativeSearchDatabase, documentIds: Set<String>, terms: List<String>): List<RankedResult> {
    if (documentIds.isEmpty()) return emptyList()
    return documentIds.mapNotNull { documentId ->
        val hit = db.firstReadableChunk(documentId) ?: return@mapNotNull null
        RankedResult(
            chunkId = hit.chunkId,
            documentId = hit.documentId,
            sourceType = hit.sourceType,
            documentTitle = hit.documentTitle,
            sectionType = hit.sectionType,
            category = resultCategory(hit.sectionType),
            sectionPath = hit.sectionPath,
            matchedTerms = matchedTerms(hit, terms),
            finalScore = 1.0,
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
