package dev.localmed.nativespike.shared.tools

import kotlinx.serialization.Serializable

/** Explicit calendar context; the engine never reads a clock or a platform time zone. */
data class NativeToolContext(val todayIso: String)

sealed interface NativeToolInput {
    @Serializable data class Number(val value: Double) : NativeToolInput
    @Serializable data class Text(val value: String) : NativeToolInput
}

@Serializable data class NativeToolSource(
    val id: String, val kind: String, val relation: String, val title: String,
    val moduleId: String? = null, val documentId: String? = null,
    val url: String? = null, val reviewedAt: String,
)
@Serializable data class NativeCalculatorSource(
    val title: String, val publisher: String, val version: String, val url: String? = null,
    val edition: String? = null, val page: String? = null, val section: String? = null, val reviewedAt: String,
)
@Serializable data class NativeToolAuthoringSource(
    val title: String, val publisher: String, val reviewedAt: String, val url: String? = null,
    val version: String? = null, val page: String? = null, val section: String? = null, val edition: String? = null,
)
@Serializable data class NativeToolLicense(val kind: String, val notice: String, val sourceUrl: String? = null)
@Serializable data class NativeToolVerdict(
    val rangeId: String, val title: String, val explanation: String, val attentionLevel: String,
    val lowerBound: Double? = null, val upperBound: Double? = null,
    val lowerInclusive: Boolean = true, val upperInclusive: Boolean = true,
    val sourceIds: List<String> = emptyList(),
)
@Serializable data class NativeToolVerdictRule(val `when`: String, val verdict: NativeToolVerdict)
@Serializable data class NativeToolEvaluationDefinition(
    val status: String, val rules: List<NativeToolVerdictRule> = emptyList(),
    val missingContext: List<String> = emptyList(), val reason: String? = null,
    val sourceIds: List<String> = emptyList(),
)
@Serializable data class NativeToolEvaluation(
    val status: String, val verdict: NativeToolVerdict? = null,
    val missingContext: List<String>, val reason: String? = null, val sourceIds: List<String>,
)
@Serializable data class NativeToolObservationMapping(
    val metricId: String, val label: String? = null, val unit: String,
    val inputId: String? = null, val stepId: String? = null, val outputId: String? = null,
    val scaleId: String? = null, val method: String? = null, val valueMultiplier: Double? = null,
)
@Serializable data class NativeToolPatientBinding(
    val kind: String, val metricId: String? = null, val unit: String? = null,
    val maxAgeDays: Int? = null, val valueMultiplier: Double? = null,
)
@Serializable data class NativeCalculatorInputOption(
    @Serializable(with = ToolScalarSerializer::class) val value: NativeToolInput, val label: String,
)
@Serializable data class NativeCalculatorInput(
    val id: String, val label: String, val labelTooltip: String? = null, val unit: String? = null,
    val kind: String, val options: List<NativeCalculatorInputOption>? = null,
    val minimum: Double? = null, val maximum: Double? = null, val inputStep: Double? = null,
    val integer: Boolean? = null, val required: Boolean, val note: String? = null,
    val defaultExpression: String? = null, val requiresInput: String? = null,
    val step: Int = 0, val patientBinding: NativeToolPatientBinding? = null,
)
@Serializable data class NativeCalculatorRequirement(val kind: String, val inputIds: List<String>, val message: String)
@Serializable data class NativeCalculatorStep(
    val id: String, val label: String, val unit: String, val expression: String,
    val displayPrecision: Int = 2, val isOutput: Boolean = false,
    val valueKind: String = "number", val stepRequired: Int = 0,
)
@Serializable data class NativeToolWarning(val code: String, val message: String)
@Serializable data class NativeCalculatorInterpretation(val `when`: String, val message: String)
@Serializable data class NativeCalculatorAssertion(val `when`: String, val error: String)
@Serializable data class NativeCalculatorSearchBindings(
    val weightKgInputId: String? = null, val ageYearsInputId: String? = null,
    val formInputId: String? = null, val routeInputId: String? = null, val indicationInputId: String? = null,
)
@Serializable data class NativeCalculatorSearchMedication(val canonicalTerm: String, val aliases: List<String> = emptyList())
@Serializable data class NativeCalculatorSearch(val kind: String, val bindings: NativeCalculatorSearchBindings, val medication: NativeCalculatorSearchMedication? = null)
@Serializable data class NativeToolAxis(
    val label: String, val minimum: Double? = null, val maximum: Double? = null,
    val minimumLabel: String? = null, val maximumLabel: String? = null, val reverse: Boolean = false,
)
@Serializable data class NativeToolQuadrantLabels(val topLeft: String, val topRight: String, val bottomLeft: String, val bottomRight: String)
@Serializable data class NativeToolAnnotation(
    val kind: String, val x: Double, val y: Double,
    val labels: NativeToolQuadrantLabels? = null, val radiusPercent: List<Double>? = null,
)
@Serializable data class NativeToolVisualPoint(
    @Serializable(with = ToolScalarSerializer::class) val x: NativeToolInput,
    @Serializable(with = ToolScalarSerializer::class) val y: NativeToolInput,
)
@Serializable data class NativeToolVisualSample(val variable: String, val from: Double, val to: Double, val step: Double, val x: String, val y: String)
@Serializable data class NativeToolVisualDataset(
    val label: String,
    val data: List<@Serializable(with = ToolScalarSerializer::class) NativeToolInput>? = null,
    val points: List<NativeToolVisualPoint>? = null, val sample: NativeToolVisualSample? = null,
    val render: String? = null, val tone: String? = null,
)
@Serializable data class NativeToolVisual(
    val id: String, val title: String, val kind: String, val labels: List<String> = emptyList(),
    val datasets: List<NativeToolVisualDataset>, val xAxis: NativeToolAxis? = null,
    val yAxis: NativeToolAxis? = null, val annotations: List<NativeToolAnnotation> = emptyList(),
    val caption: String? = null, val heightPx: Int? = null,
)
@Serializable data class NativeCalculatorDefinition(
    val schemaVersion: Int, val id: String, val slug: String, val title: String, val shortTitle: String,
    val aliases: List<String> = emptyList(), val summary: String, val audience: String, val category: String,
    val tags: List<String> = emptyList(), val clinical: Boolean, val formulaDisplay: String,
    val population: String, val limitations: List<String>, val inputs: List<NativeCalculatorInput>,
    val inputRequirements: List<NativeCalculatorRequirement> = emptyList(), val steps: List<NativeCalculatorStep>,
    val warnings: List<NativeToolWarning> = emptyList(), val interpretations: List<NativeCalculatorInterpretation> = emptyList(),
    val evaluation: NativeToolEvaluationDefinition, val observationMappings: List<NativeToolObservationMapping> = emptyList(),
    val assertions: List<NativeCalculatorAssertion> = emptyList(), val visuals: List<NativeToolVisual> = emptyList(),
    val search: NativeCalculatorSearch? = null, val sources: List<NativeCalculatorSource>,
)
@Serializable data class NativeAssessmentOption(val value: Double, val label: String, val hideValue: Boolean? = null)
@Serializable data class NativeAssessmentScale(val id: String, val label: String, val shortLabel: String, val description: String)
@Serializable data class NativeAssessmentQuestion(
    val id: String, val prompt: String, val scaleId: String, val reverse: Boolean? = null,
    val responseOptions: List<NativeAssessmentOption>? = null,
)
@Serializable data class NativeAssessmentInterpretation(
    val minScore: Double? = null, val maxScore: Double? = null, val scaleId: String? = null,
    val `when`: String? = null, val headline: String, val message: String,
)
@Serializable data class NativeAssessmentDefinition(
    val schemaVersion: Int, val id: String, val slug: String, val title: String, val shortTitle: String,
    val aliases: List<String>, val bankId: String, val bankLabel: String, val category: String,
    val description: String, val estimatedMinutes: Int, val audience: String,
    val responseOptions: List<NativeAssessmentOption>, val scales: List<NativeAssessmentScale>,
    val questions: List<NativeAssessmentQuestion>, val disclaimer: String, val evidenceNote: String,
    val interpretations: List<NativeAssessmentInterpretation>? = null, val visuals: List<NativeToolVisual> = emptyList(),
    val evaluation: NativeToolEvaluationDefinition, val observationMappings: List<NativeToolObservationMapping> = emptyList(),
    val license: NativeToolLicense, val scoringMode: String? = null,
    // Original authoring metadata retained; the assessment contract does not execute calculator assertions.
    val clinical: Boolean? = null, val formulaDisplay: String? = null, val population: String? = null,
    val limitations: List<String>? = null, val assertions: List<NativeCalculatorAssertion>? = null,
    val sources: List<NativeToolAuthoringSource>? = null,
)

sealed interface NativeToolDefinition {
    data class Calculator(val value: NativeCalculatorDefinition) : NativeToolDefinition
    data class Assessment(val value: NativeAssessmentDefinition) : NativeToolDefinition
}
data class NativeToolRecord(
    val id: String, val kind: String, val version: String, val slug: String, val title: String,
    val shortTitle: String, val aliases: List<String>, val bankId: String, val bankLabel: String,
    val category: String, val description: String, val estimatedMinutes: Int, val audience: String,
    val definition: NativeToolDefinition, val sources: List<NativeToolSource>,
)
@Serializable data class NativeToolModuleSource(val path: String, val id: String, val version: String, val sha256: String, val toolCount: Int)

@Serializable sealed interface NativeToolChartPoint {
    @Serializable data class Number(val value: Double) : NativeToolChartPoint
    @Serializable data class XY(val x: Double, val y: Double) : NativeToolChartPoint
}
@Serializable data class NativeToolChartDataset(val label: String, val data: List<NativeToolChartPoint>, val render: String? = null, val tone: String? = null)
@Serializable data class NativeToolChart(
    val type: String, val title: String, val labels: List<String>, val datasets: List<NativeToolChartDataset>,
    val caption: String? = null, val heightPx: Int? = null, val xAxis: NativeToolAxis? = null,
    val yAxis: NativeToolAxis? = null, val annotations: List<NativeToolAnnotation>? = null,
)
@Serializable sealed interface NativeCalculatorOutput {
    val id: String
    val label: String
    @Serializable data class Number(override val id: String, override val label: String, val value: Double, val unit: String, val displayPrecision: Int) : NativeCalculatorOutput
    @Serializable data class Text(override val id: String, override val label: String, val text: String) : NativeCalculatorOutput
    @Serializable data class Visual(override val id: String, override val label: String, val chart: NativeToolChart) : NativeCalculatorOutput
}
@Serializable data class NativeToolTrace(val id: String? = null, val label: String, val expression: String, val value: Double, val unit: String)
@Serializable sealed interface NativeCalculatorResult {
    @Serializable data class Success(val calculatorId: String, val formula: String, val outputs: List<NativeCalculatorOutput>, val trace: List<NativeToolTrace>, val warnings: List<NativeToolWarning>, val evaluation: NativeToolEvaluation) : NativeCalculatorResult
    @Serializable data class Failure(val error: String) : NativeCalculatorResult
}
@Serializable data class NativeAssessmentScaleScore(val scaleId: String, val label: String, val shortLabel: String, val rawScore: Double, val minimumScore: Double, val maximumScore: Double, val percent: Double)
@Serializable data class NativeAssessmentScore(
    val assessmentId: String, val completedAt: String, val scores: List<NativeAssessmentScaleScore>,
    val primaryScaleIds: List<String>, val headline: String, val summary: String, val disclaimer: String,
    val visuals: List<NativeToolChart>? = null, val evaluation: NativeToolEvaluation,
)
@Serializable sealed interface NativeAssessmentResult {
    @Serializable data class Success(val value: NativeAssessmentScore) : NativeAssessmentResult
    @Serializable data class Failure(val error: String) : NativeAssessmentResult
}

@Serializable data class NativeToolModelSource(val path: String, val sha256: String)
