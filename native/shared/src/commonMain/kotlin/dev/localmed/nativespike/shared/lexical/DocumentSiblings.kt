package dev.localmed.nativespike.shared.lexical

/** A Kotlin port of `packages/core/src/document-siblings.ts` — stage 2 sub-stage D. */

private fun withoutFullSuffix(documentId: String): String =
    if (documentId.endsWith(".full")) documentId.substring(0, documentId.length - 5) else documentId

/** Mirrors `fullDocumentCandidateId`. */
fun fullDocumentCandidateId(documentId: String): String =
    if (documentId.endsWith(".full")) documentId else "$documentId.full"

/** Mirrors `fullDocumentCandidateIds`. `clinicalId`: `/^(kr\.rf\.\d+_\d+)(?:\.|$)/` — a literal
 * `"kr.rf."` prefix then digits, underscore, digits, then end-of-string or a dot; no Cyrillic
 * character classes, so a plain scan suffices without the usual Regex caution. */
fun fullDocumentCandidateIds(documentId: String): List<String> {
    val clinicalId = clinicalIdPrefix(documentId)
    val candidates = LinkedHashSet<String>()
    if (clinicalId != null && clinicalId != documentId) candidates.add(clinicalId)
    candidates.add(fullDocumentCandidateId(documentId))
    return candidates.filter { it != documentId }
}

private fun clinicalIdPrefix(documentId: String): String? {
    val prefix = "kr.rf."
    if (!documentId.startsWith(prefix)) return null
    var i = prefix.length
    val n = documentId.length
    val start = i
    while (i < n && documentId[i] in '0'..'9') i += 1
    if (i == start) return null
    if (i >= n || documentId[i] != '_') return null
    i += 1
    val secondStart = i
    while (i < n && documentId[i] in '0'..'9') i += 1
    if (i == secondStart) return null
    if (i < n && documentId[i] != '.') return null
    return documentId.substring(0, i)
}

/** Mirrors `resolveReadableDocumentId`. */
fun resolveReadableDocumentId(documentId: String, availableIds: Set<String>): String =
    fullDocumentCandidateIds(documentId).firstOrNull { it in availableIds } ?: documentId

/** Mirrors `isSupersededSummaryDocument`. */
fun isSupersededSummaryDocument(documentId: String, availableIds: Set<String>): Boolean =
    resolveReadableDocumentId(documentId, availableIds) != documentId
