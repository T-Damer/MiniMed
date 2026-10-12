package dev.localmed.nativespike.shared.patient

import dev.localmed.nativespike.shared.tools.NativeToolInput
import dev.localmed.nativespike.shared.tools.ToolScalarSerializer
import kotlinx.serialization.Required
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator

const val NATIVE_PATIENT_DOMAIN_SCHEMA_VERSION = 2
/** The pure domain owns neither a clock nor identifier generator nor persistence. */
data class NativePatientContext(val nowIso: () -> String, val randomUuid: () -> String)
typealias NativePatientValues = Map<String, @Serializable(with = ToolScalarSerializer::class) NativeToolInput>

@Serializable data class NativePatientAvatar(val kind: String, val value: String)
@Serializable data class NativePatientProfile(
    val id: String, val displayName: String, val createdAt: String, val updatedAt: String,
    val avatar: NativePatientAvatar? = null, val localRecordNumber: String? = null,
    val birthDate: String? = null, val biologicalSex: String? = null, val summary: String? = null,
    val context: NativePatientValues? = null,
)
@Serializable data class NativeClinicalEpisode(
    val id: String, val patientId: String, val title: String, val startedAt: String,
    val text: String, val eventIds: List<String>, val status: String,
    val createdAt: String, val updatedAt: String, val closedAt: String? = null,
)
@Serializable data class NativePatientMetricDefinition(
    val id: String, val metricId: String, val label: String, val unit: String,
    val metricVersion: String, val kind: String, val createdAt: String,
)
@Serializable data class NativeLaboratoryRange(
    val lower: Double? = null, val upper: Double? = null,
    val lowerInclusive: Boolean? = null, val upperInclusive: Boolean? = null, val text: String? = null,
)
@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable @JsonClassDiscriminator("kind") sealed interface NativePatientObservationSource {
    @Serializable @SerialName("tool-result") data class ToolResult(val toolId: String, val toolVersion: String) : NativePatientObservationSource
    @Serializable @SerialName("manual") data class Manual(val label: String, val metricVersion: String) : NativePatientObservationSource
    @Serializable @SerialName("laboratory") data class Laboratory(val label: String, val reportRange: NativeLaboratoryRange? = null) : NativePatientObservationSource
}
@Serializable data class NativePatientSourceSnapshot(
    val id: String, val title: String, val moduleId: String? = null,
    val documentId: String? = null, val url: String? = null,
)
/** Optional keys retain the recorded verdict, rather than materialising tool-schema defaults. */
@Serializable(with = NativePatientVerdictSerializer::class) data class NativePatientVerdict(
    val rangeId: String, val title: String, val explanation: String, val attentionLevel: String,
    val lowerBound: Double? = null, val upperBound: Double? = null,
    val lowerInclusive: Boolean? = null, val upperInclusive: Boolean? = null, val sourceIds: List<String>? = null,
    internal val originalRecord: kotlinx.serialization.json.JsonObject? = null,
)
@Serializable data class NativePatientEvaluationSnapshot(
    val status: String, val context: NativePatientValues, val capturedAt: String,
    val verdict: NativePatientVerdict? = null, val missingContext: List<String>? = null,
    val reason: String? = null, val sourceIds: List<String>? = null,
    val sourceLinks: List<NativePatientSourceSnapshot>? = null,
)
@Serializable data class NativeToolResultProvenance(
    val toolId: String, val toolVersion: String, val definitionVersion: String,
    val sourceIds: List<String>, val idempotencyKey: String,
    val normalizedInputs: NativePatientValues, val contextSnapshot: NativePatientValues,
    val sourceLinks: List<NativePatientSourceSnapshot>? = null,
)
@Serializable data class NativePatientObservation(
    val id: String, val patientId: String, val eventId: String, val metricId: String,
    val value: Double, val unit: String, val observedAt: String, val source: NativePatientObservationSource,
    val method: String? = null, val evaluation: NativePatientEvaluationSnapshot? = null,
    val revisionOf: String? = null, val supersededBy: String? = null,
)
@Serializable data class NativePatientEvent(
    val id: String, val patientId: String, val kind: String, val occurredAt: String,
    val title: String, val observations: List<NativePatientObservation>, val immutable: Boolean,
    val episodeId: String? = null, val text: String? = null, val medicationKind: String? = null,
    val provenance: NativeToolResultProvenance? = null, val revisionOf: String? = null, val supersededBy: String? = null,
)
@Serializable data class NativePatientVaultSnapshot(
    @Required val schemaVersion: Int = NATIVE_PATIENT_DOMAIN_SCHEMA_VERSION,
    @Required val profiles: List<NativePatientProfile> = emptyList(),
    @Required val episodes: List<NativeClinicalEpisode> = emptyList(),
    @Required val events: List<NativePatientEvent> = emptyList(),
    @Required val observations: List<NativePatientObservation> = emptyList(),
    @Required val metricDefinitions: List<NativePatientMetricDefinition> = emptyList(),
)
@Serializable data class NativeCreatePatientProfileInput(
    val displayName: String, val id: String? = null, val avatar: NativePatientAvatar? = null,
    val localRecordNumber: String? = null, val birthDate: String? = null,
    val biologicalSex: String? = null, val summary: String? = null, val context: NativePatientValues? = null,
    val createdAt: String? = null, val weightKg: Double? = null, val heightCm: Double? = null,
)
@Serializable data class NativeCreatedPatientProfile(val profile: NativePatientProfile, val initialEvents: List<NativePatientEvent>)
@Serializable data class NativeCreateClinicalEpisodeInput(val patientId: String, val title: String? = null, val startedAt: String? = null, val text: String? = null, val id: String? = null)
@Serializable data class NativeCreateMeasurementInput(
    val patientId: String, val metricId: String, val label: String, val value: Double, val unit: String,
    val episodeId: String? = null, val occurredAt: String? = null, val method: String? = null, val id: String? = null,
    val reportRange: NativeLaboratoryRange? = null,
)
@Serializable data class NativeCreateMedicationInput(val patientId: String, val medicationKind: String, val title: String, val episodeId: String? = null, val occurredAt: String? = null, val text: String? = null, val id: String? = null)
@Serializable data class NativeToolResultObservation(
    val metricId: String, val value: Double, val unit: String, val observedAt: String, val source: NativePatientObservationSource,
    val method: String? = null, val evaluation: NativePatientEvaluationSnapshot? = null, val revisionOf: String? = null, val supersededBy: String? = null,
)
@Serializable data class NativeCreateToolResultInput(
    val patientId: String, val title: String, val provenance: NativeToolResultProvenance,
    val observations: List<NativeToolResultObservation>, val episodeId: String? = null,
    val occurredAt: String? = null, val text: String? = null, val id: String? = null,
)
@Serializable data class NativeAppendToolResult(val snapshot: NativePatientVaultSnapshot, val event: NativePatientEvent, val created: Boolean)
@Serializable data class NativeReviseObservationInput(val value: Double, val unit: String? = null, val occurredAt: String? = null)
@Serializable data class NativePatientAge(val years: Int, val months: Int, val days: Int)
@Serializable data class NativeDynamicsSeries(val key: String, val metricId: String, val unit: String, val method: String, val observations: List<NativePatientObservation>)
@Serializable data class NativeDynamicsChartGroup(val key: String, val metricId: String, val unit: String, val series: List<NativeDynamicsSeries>)
