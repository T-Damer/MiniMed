package dev.localmed.nativespike.shared.tools

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement

internal object ToolScalarSerializer : KSerializer<NativeToolInput> {
    override val descriptor = PrimitiveSerialDescriptor("ToolScalar", PrimitiveKind.STRING)
    override fun deserialize(decoder: Decoder): NativeToolInput {
        val value = (decoder as JsonDecoder).decodeJsonElement() as? JsonPrimitive ?: error("Expected scalar tool value")
        return if (value.isString) NativeToolInput.Text(value.content) else NativeToolInput.Number(value.doubleOrNull ?: error("Expected numeric tool value"))
    }
    override fun serialize(encoder: Encoder, value: NativeToolInput) {
        (encoder as JsonEncoder).encodeJsonElement(when (value) {
            is NativeToolInput.Number -> JsonPrimitive(value.value)
            is NativeToolInput.Text -> JsonPrimitive(value.value)
        })
    }
}
@Serializable internal data class RawToolRecord(
    val id: String, val kind: String, val version: String, val slug: String, val title: String,
    val shortTitle: String, val aliases: List<String> = emptyList(), val bankId: String, val bankLabel: String,
    val category: String, val description: String, val estimatedMinutes: Int, val audience: String,
    val definition: JsonObject, val sources: List<NativeToolSource> = emptyList(),
)
@Serializable internal data class TableSource<T>(val path: String, val sha256: String, val tables: T)
@Serializable internal data class WhoTable(val axis: String, val start: Int, val end: Int, val adjusted: Boolean, val encoded: String)
@Serializable internal data class GailTable(val beta: List<Double>, val incidence: List<Double>, val mortality: List<Double>, val attributableRisk: List<Double>)
internal data class BpRow(val age: Int, val columns: List<List<Double>>)
@Serializable internal data class RawToolBank(
    val schemaVersion: Int, val modules: List<NativeToolModuleSource>, val records: List<RawToolRecord>, val catalogOrder: List<String>, val catalogSource: NativeToolModelSource,
    val who: TableSource<Map<String, WhoTable>>, val aap: TableSource<JsonObject>,
    val gail: TableSource<Map<String, GailTable>>,
)
internal class NativeToolBank(text: String) {
    private val json = Json { ignoreUnknownKeys = false }
    private val raw = json.decodeFromString<RawToolBank>(text)
    val modelSources = listOf(raw.who.path to raw.who.sha256, raw.aap.path to raw.aap.sha256, raw.gail.path to raw.gail.sha256).map { NativeToolModelSource(it.first, it.second) }
    val catalogSource = raw.catalogSource
    val catalogOrder = raw.catalogOrder
    val modules = raw.modules
    val who = raw.who.tables
    val gail = raw.gail.tables
    val aap = raw.aap.tables.mapValues { (_, value) -> value.jsonArray.map { rowElement ->
        val row = rowElement.jsonArray
        require(row.size == 8) { "Invalid AAP row" }
        BpRow(row[0].jsonPrimitive.int, row.drop(1).map { column -> column.jsonArray.map { it.jsonPrimitive.doubleOrNull ?: error("Invalid AAP number") } })
    } }
    val records: List<NativeToolRecord>
    init {
        require(raw.catalogSource.path.isNotBlank() && Regex("[a-f0-9]{64}").matches(raw.catalogSource.sha256)) { "Invalid tool catalog provenance" }
        require(raw.catalogOrder.size == raw.records.size && raw.catalogOrder.toSet().size == raw.catalogOrder.size && raw.catalogOrder.toSet() == raw.records.map { it.id }.toSet()) { "Tool catalog order must contain every exact bank identity once" }
        require(raw.schemaVersion == 1) { "Unsupported tool bank format" }
        require(modules.isNotEmpty() && modules.map { it.id }.distinct().size == modules.size) { "Invalid tool modules" }
        modules.forEach { require(it.id.isNotBlank() && it.version.isNotBlank() && it.path.isNotBlank() && it.toolCount >= 0 && sha(it.sha256)) }
        listOf(raw.who.path to raw.who.sha256, raw.aap.path to raw.aap.sha256, raw.gail.path to raw.gail.sha256).forEach { (path, digest) -> require(path.isNotBlank() && sha(digest)) }
        require(modules.sumOf { it.toolCount } == raw.records.size) { "Tool inventory count mismatch" }
        require(raw.records.map { it.id }.distinct().size == raw.records.size) { "Duplicate tool identity" }
        records = raw.records.map { record ->
            require(listOf(record.id, record.version, record.slug, record.title, record.shortTitle, record.bankId, record.bankLabel, record.category, record.description, record.audience).all { it.isNotBlank() } && record.estimatedMinutes > 0)
            record.sources.forEach { require(it.id.isNotBlank() && it.title.isNotBlank() && it.reviewedAt.isNotBlank()); url(it.url); require(it.kind in setOf("clinical-recommendation", "literature", "guideline", "regulatory") && it.relation in setOf("methodology", "interpretation", "clinical-context")) }
            val definition = when (record.kind) {
                "calculator" -> NativeToolDefinition.Calculator(json.decodeFromJsonElement<NativeCalculatorDefinition>(record.definition).also { validateCalculator(it); require(it.id == record.id) { "Tool payload identity mismatch" } })
                "assessment" -> NativeToolDefinition.Assessment(json.decodeFromJsonElement<NativeAssessmentDefinition>(record.definition).also { validateAssessment(it); require(it.id == record.id) { "Tool payload identity mismatch" } })
                else -> error("Unsupported tool kind")
            }
            NativeToolRecord(record.id, record.kind, record.version, record.slug, record.title, record.shortTitle, record.aliases, record.bankId, record.bankLabel, record.category, record.description, record.estimatedMinutes, record.audience, definition, record.sources)
        }
        who.values.forEach { require(it.axis in setOf("age-days", "age-months", "length-tenths") && it.start <= it.end && it.encoded.isNotEmpty()) }
        require(aap.keys == setOf("male", "female")); aap.values.forEach { rows -> require(rows.size == 17); rows.forEachIndexed { index, row -> require(row.age == index + 1 && row.columns.all { it.size == 7 && it.all(Double::isFinite) }) } }
        require(gail.keys == setOf("white", "black", "hispanic", "asian", "other")); gail.values.forEach { require(it.beta.size == 6 && it.incidence.size == 14 && it.mortality.size == 14 && it.attributableRisk.size == 2); require((it.beta + it.incidence + it.mortality + it.attributableRisk).all(Double::isFinite)) }
    }
}
private val identifier = Regex("^[a-zA-Z_][a-zA-Z0-9_]*$")
private fun sha(value: String) = Regex("^[a-f0-9]{64}$").matches(value)
private fun url(value: String?) { require(value == null || Regex("^https?://[^\\s/]+(?:/[^\\s]*)?$").matches(value)) { "Source URL must use HTTP(S)" } }
private fun finite(value: Double?) { require(value == null || value.isFinite()) }
private fun optionalText(vararg values: String?) { require(values.all { it == null || it.isNotEmpty() }) }
private val mappingIdentifier = Regex("^[a-zA-Z_][a-zA-Z0-9_.-]*$")
private fun validatePatientBinding(value: NativeToolPatientBinding) {
    require(value.kind in setOf("birthDate", "dateOfBirth", "biologicalSex", "ageAtEvent", "latestObservation", "latestMeasurement"))
    require(value.metricId == null || mappingIdentifier.matches(value.metricId))
    require(value.kind !in setOf("latestObservation", "latestMeasurement") || value.metricId != null)
    optionalText(value.unit)
    require(value.maxAgeDays == null || value.maxAgeDays >= 0)
    require(value.valueMultiplier == null || (value.valueMultiplier.isFinite() && value.valueMultiplier > 0))
}
private fun validateEvaluation(value: NativeToolEvaluationDefinition) {
    require(value.status in setOf("verdict", "missing-context", "unavailable", "not-applicable"))
    require(value.status != "verdict" || value.rules.isNotEmpty())
    optionalText(value.reason); require((value.sourceIds + value.missingContext).all { it.isNotEmpty() })
    value.rules.forEach { rule ->
        require(rule.`when`.isNotBlank()); val v = rule.verdict
        require(listOf(v.rangeId, v.title, v.explanation).all { it.isNotBlank() } && v.attentionLevel in setOf("none", "low", "moderate", "high", "urgent"))
        require(v.sourceIds.all { it.isNotEmpty() }); finite(v.lowerBound); finite(v.upperBound); require(v.lowerBound == null || v.upperBound == null || v.lowerBound <= v.upperBound)
    }
}
private fun validateMappings(values: List<NativeToolObservationMapping>) { values.forEach { v -> require(mappingIdentifier.matches(v.metricId) && v.unit.isNotBlank() && listOf(v.inputId, v.stepId, v.outputId, v.scaleId).count { it != null } == 1); require(v.valueMultiplier == null || (v.valueMultiplier.isFinite() && v.valueMultiplier > 0)); optionalText(v.label, v.method); require(listOfNotNull(v.inputId, v.stepId, v.outputId, v.scaleId).all { mappingIdentifier.matches(it) }) } }
private fun validateVisuals(values: List<NativeToolVisual>) { values.forEach { v ->
    require(identifier.matches(v.id) && v.title.isNotBlank() && v.kind in setOf("bar", "line", "pie", "doughnut", "scatter") && v.datasets.isNotEmpty())
    require(v.heightPx == null || v.heightPx in 80..600)
    listOfNotNull(v.xAxis, v.yAxis).forEach { require(it.label.isNotBlank()); finite(it.minimum); finite(it.maximum) }
    v.annotations.forEach { a -> require(a.x.isFinite() && a.y.isFinite()); when(a.kind) { "quadrants" -> require(a.labels != null); "rings" -> require(!a.radiusPercent.isNullOrEmpty() && a.radiusPercent.all { it.isFinite() && it > 0 && it <= 50 }); else -> error("Unsupported chart annotation") } }
    v.datasets.forEach { d ->
        require(d.label.isNotBlank() && listOf(d.data, d.points, d.sample).count { it != null } == 1)
        require(d.render == null || d.render in setOf("line", "point")); require(d.tone == null || d.tone in setOf("neutral", "danger", "warning", "success", "accent"))
        d.data?.let { require(it.isNotEmpty()) }; d.points?.let { require(it.isNotEmpty()) }
        d.sample?.let { require(identifier.matches(it.variable) && it.from.isFinite() && it.to.isFinite() && it.step.isFinite() && it.step > 0 && it.to >= it.from && kotlin.math.floor((it.to - it.from) / it.step + 1e-9) + 1 <= 1000) }
    }
} }
private fun validateCalculator(v: NativeCalculatorDefinition) {
    require(v.schemaVersion == 2 && listOf(v.id, v.slug, v.title, v.shortTitle, v.summary, v.formulaDisplay, v.population).all { it.isNotBlank() })
    require(v.audience in setOf("all", "adult", "pediatric"))
    val categories = setOf("unit-conversion", "renal", "anthropometry", "fluids", "medication", "screening", "obstetrics", "gynecology", "emergency", "cardiology", "gastroenterology", "hematology", "neonatology", "pediatrics")
    require(v.category in categories && v.tags.all { it in categories } && v.limitations.isNotEmpty() && v.sources.isNotEmpty())
    require(v.inputs.isNotEmpty() && v.steps.isNotEmpty() && v.steps.any { it.isOutput })
    val ids = v.inputs.map { it.id } + v.steps.map { it.id }; require(ids.distinct().size == ids.size)
    v.inputs.forEach { i -> require(identifier.matches(i.id) && i.label.isNotBlank() && i.kind in setOf("number", "select", "date", "text", "checkbox") && i.step >= 0); finite(i.minimum); finite(i.maximum); require(i.inputStep == null || (i.inputStep.isFinite() && i.inputStep > 0)); optionalText(i.labelTooltip, i.unit, i.note, i.defaultExpression); require(i.requiresInput == null || identifier.matches(i.requiresInput)); i.patientBinding?.let(::validatePatientBinding); i.options?.forEach { require(it.label.isNotBlank()); if (it.value is NativeToolInput.Number) require(it.value.value.isFinite()) } }
    v.steps.forEach { require(identifier.matches(it.id) && it.label.isNotBlank() && it.unit.isNotBlank() && it.expression.isNotBlank() && it.displayPrecision in 0..10 && it.stepRequired >= 0 && it.valueKind in setOf("number", "text", "date")) }
    v.inputRequirements.forEach { require(it.kind == "atLeastOne" && it.inputIds.size >= 2 && it.inputIds.distinct().size == it.inputIds.size && it.inputIds.all { id -> v.inputs.any { input -> input.id == id } } && it.message.isNotBlank()) }
    v.sources.forEach { require(listOf(it.title, it.publisher, it.version, it.reviewedAt).all { it.isNotBlank() }); optionalText(it.edition, it.page, it.section); url(it.url) }
    require((v.aliases + v.limitations).all { it.isNotEmpty() }); v.warnings.forEach { require(it.code.isNotEmpty() && it.message.isNotEmpty()) }; v.assertions.forEach { require(it.`when`.isNotEmpty() && it.error.isNotEmpty()) }; v.interpretations.forEach { require(it.`when`.isNotEmpty() && it.message.isNotEmpty()) }
    v.search?.let { search -> require(search.kind in setOf("medication-dose", "infusion-volume")); require(search.kind != "medication-dose" || search.medication != null); search.medication?.let { require(it.canonicalTerm.isNotEmpty() && it.aliases.all { alias -> alias.isNotEmpty() }) } }
    v.search?.bindings?.let { b -> val select = setOfNotNull(b.formInputId, b.routeInputId, b.indicationInputId); val all = select + setOfNotNull(b.weightKgInputId, b.ageYearsInputId); require(all.all { id -> v.inputs.any { it.id == id } } && select.all { id -> v.inputs.any { it.id == id && it.kind == "select" } }) }
    validateEvaluation(v.evaluation); validateMappings(v.observationMappings); validateVisuals(v.visuals)
}
private fun validateAssessment(v: NativeAssessmentDefinition) {
    require(v.schemaVersion == 2 && listOf(v.id, v.slug, v.title, v.shortTitle, v.bankId, v.bankLabel, v.description, v.audience, v.disclaimer, v.evidenceNote).all { it.isNotBlank() } && v.estimatedMinutes > 0)
    require(v.category.isNotEmpty() && v.aliases.all { it.isNotEmpty() })
    fun options(values: List<NativeAssessmentOption>) { values.forEach { require(it.value.isFinite() && it.value % 1.0 == 0.0 && it.value in 0.0..100.0 && it.label.isNotBlank()) } }
    options(v.responseOptions); v.questions.forEach { require(it.id.isNotBlank() && it.prompt.isNotBlank() && it.scaleId.isNotBlank() && it.reverse != false); it.responseOptions?.let(::options) }
    v.scales.forEach { require(listOf(it.id, it.label, it.shortLabel, it.description).all { it.isNotBlank() }) }
    v.interpretations?.forEach { require(it.headline.isNotBlank() && it.message.isNotBlank()); val hasBand = it.minScore != null || it.maxScore != null; require(!it.`when`.isNullOrBlank() != hasBand); require(!hasBand || (it.minScore != null && it.maxScore != null)); finite(it.minScore); finite(it.maxScore) }
    v.sources?.forEach { require(listOf(it.title, it.publisher, it.reviewedAt).all { text -> text.isNotBlank() }); optionalText(it.version, it.page, it.section, it.edition); url(it.url) }
    v.assertions?.forEach { require(it.`when`.isNotBlank() && it.error.isNotBlank()) }
    require(v.license.kind in setOf("project-original", "public-domain-derived", "third-party-attributed") && v.license.notice.isNotBlank()); url(v.license.sourceUrl)
    require(v.scoringMode == null) { "Source assessment schema does not declare scoringMode" }
    validateEvaluation(v.evaluation); validateMappings(v.observationMappings); validateVisuals(v.visuals)
}
