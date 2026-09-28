package dev.localmed.nativespike.shared.model

/** Document-level fields `query-group-ranking.ts`/`ScopedMedicalCore.ts` read, built once per
 * distinct document id seen across a query's hydrated hits (not per chunk/result). */
data class DocumentDescriptor(
    val id: String,
    val sourceType: String,
    val title: String,
    val catalogFamily: String?,
    val entityType: String?,
    val targetDocumentId: String?,
    val contentMode: String?,
    val notLegalAdvice: Boolean,
    val interactiveAssessmentId: String?,
    val calculationRequired: Boolean,
    val interactiveCalculatorId: String?,
    val navigationAliases: List<String>,
    val ageGroups: List<String>,
)
