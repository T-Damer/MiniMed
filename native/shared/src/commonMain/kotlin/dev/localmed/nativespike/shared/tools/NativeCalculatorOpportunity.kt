package dev.localmed.nativespike.shared.tools

import dev.localmed.nativespike.shared.model.QueryAnalysis
import dev.localmed.nativespike.shared.model.QueryCalculation
import dev.localmed.nativespike.shared.model.QueryFact
import dev.localmed.nativespike.shared.model.QueryFactPolarity
import dev.localmed.nativespike.shared.text.compatibilityNormalize
import dev.localmed.nativespike.shared.text.jsNumberToString
import dev.localmed.nativespike.shared.text.lightStemRussian
import dev.localmed.nativespike.shared.text.tokenize

/** A proposed schema binding, not a dose or a clinical recommendation. */
data class NativeCalculatorOpportunityCandidate(
    val calculatorId: String, val label: String, val canonicalTerm: String? = null,
    val matchedText: String? = null, val matchType: String? = null,
    val draftInputs: Map<String, NativeToolInput>, val formOptions: List<NativeCalculatorInputOption>,
    val routeOptions: List<NativeCalculatorInputOption>, val indicationOptions: List<NativeCalculatorInputOption>,
)
data class NativeCalculatorOpportunity(
    val kind: String, val candidates: List<NativeCalculatorOpportunityCandidate>,
    val selectedCalculatorId: String?, val requiresConfirmation: Boolean,
    val draftInputs: Map<String, NativeToolInput>, val formOptions: List<NativeCalculatorInputOption>,
    val routeOptions: List<NativeCalculatorInputOption>, val indicationOptions: List<NativeCalculatorInputOption>,
)
private fun normalized(value: String) = compatibilityNormalize(value).trim(::toolJsWhitespace)
    .replace(Regex("[\\t\\n\\u000b\\u000c\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+"), " ").lowercase().replace('ё','е')
private fun scalarText(value: NativeToolInput) = when(value) { is NativeToolInput.Text -> value.value; is NativeToolInput.Number -> jsNumberToString(value.value) }
private fun options(schema: NativeCalculatorDefinition, id: String?) = schema.inputs.find { it.id == id }?.options.orEmpty()
private fun uniqueAmount(facts: List<QueryFact>, pattern: Regex, positive: Boolean): Double? {
    val values = facts.filter { it.polarity == QueryFactPolarity.POSITIVE }.mapNotNull { fact ->
        pattern.find(normalized(fact.normalizedValue.ifEmpty { fact.value }).replace(',','.'))?.groupValues?.get(1)?.toDoubleOrNull()
    }.filter { it.isFinite() && if (positive) it > 0 else it >= 0 }
    return values.singleOrNull()
}
private fun contextOption(facts: List<QueryFact>, options: List<NativeCalculatorInputOption>): NativeToolInput? {
    val matches = linkedMapOf<String, NativeToolInput>()
    for(fact in facts.filter { it.polarity == QueryFactPolarity.POSITIVE }) {
        val text = normalized(fact.normalizedValue.ifEmpty { fact.value }); if(text.isEmpty()) continue
        val match = options.filter { normalized(scalarText(it.value)) == text || normalized(it.label) == text }.singleOrNull() ?: continue
        matches[(if(match.value is NativeToolInput.Number) "number:" else "string:") + scalarText(match.value)] = match.value
    }
    return matches.values.singleOrNull()
}
private fun queryOption(query: String, options: List<NativeCalculatorInputOption>): NativeToolInput? {
    val text = " ${normalized(query)} "; val terms = tokenize(text).map(::lightStemRussian).toSet()
    return options.filter { option -> listOf(scalarText(option.value),option.label).any { value ->
        val term = normalized(value)
        if(term.length <= 2) false else text.contains(" $term ") || tokenize(term).map(::lightStemRussian).let { it.isNotEmpty() && it.all(terms::contains) }
    } }.singleOrNull()?.value
}
private fun draft(schema: NativeCalculatorDefinition, search: NativeCalculatorSearch, analysis: QueryAnalysis): Map<String, NativeToolInput> = buildMap {
    val b = search.bindings; val c = analysis.clinicalContext
    b.indicationInputId?.let { id -> queryOption(analysis.originalQuery,options(schema,id))?.let { put(id,it) } }
    b.ageYearsInputId?.let { id -> if(schema.inputs.find { it.id == id }?.kind == "number") uniqueAmount(c.age,Regex("^(\\d+(?:\\.\\d+)?)\\s+(?:год|года|лет)$"),false)?.let { put(id,NativeToolInput.Number(it)) } }
    b.weightKgInputId?.let { id -> if(schema.inputs.find { it.id == id }?.kind == "number") uniqueAmount(c.weight,Regex("^(\\d+(?:\\.\\d+)?)\\s*(?:кг|килограмм(?:а|ов)?)$"),true)?.let { put(id,NativeToolInput.Number(it)) } }
    b.formInputId?.let { id -> contextOption(c.doseForm,options(schema,id))?.let { put(id,it) } }
    b.routeInputId?.let { id -> contextOption(c.route,options(schema,id))?.let { put(id,it) } }
}

fun NativeToolCore.calculatorOpportunity(analysis: QueryAnalysis): NativeCalculatorOpportunity? = resolveNativeCalculatorOpportunity(analysis,tools().mapNotNull { (it.definition as? NativeToolDefinition.Calculator)?.value })

fun resolveNativeCalculatorOpportunity(analysis: QueryAnalysis, schemas: List<NativeCalculatorDefinition>): NativeCalculatorOpportunity? {
    val calculation = analysis.calculation ?: return null
    if(calculation is QueryCalculation.MedicationDose && calculation.medicationCandidates.isEmpty()) return null
    val kind = if(calculation is QueryCalculation.InfusionVolume) "infusion-volume" else "medication-dose"
    val available = schemas.filter { it.sources.isNotEmpty() && it.search?.kind == kind }
    val candidates = mutableListOf<NativeCalculatorOpportunityCandidate>()
    fun add(schema: NativeCalculatorDefinition, canonical: String? = null, matched: String? = null, match: String? = null) {
        val search = schema.search ?: return
        candidates += NativeCalculatorOpportunityCandidate(schema.id,canonical ?: schema.shortTitle,canonical,matched,match,
            draft(schema,search,analysis),options(schema,search.bindings.formInputId),options(schema,search.bindings.routeInputId),options(schema,search.bindings.indicationInputId))
    }
    when(calculation) {
        is QueryCalculation.InfusionVolume -> available.forEach { add(it) }
        is QueryCalculation.MedicationDose -> for(candidate in calculation.medicationCandidates) {
            if(candidate.matchType !in setOf("exact","fuzzy")) continue
            val term = normalized(candidate.canonicalTerm); if(term.isEmpty()) continue
            available.filter { schema -> schema.search?.medication?.let { (listOf(it.canonicalTerm)+it.aliases).any { normalized(it) == term } } == true }
                .forEach { schema -> add(schema,schema.search!!.medication!!.canonicalTerm,candidate.matchedText,candidate.matchType) }
        }
    }
    if(candidates.isEmpty()) return null
    val ids = candidates.map { it.calculatorId }.toSet()
    val confirm = candidates.size != 1 || calculation is QueryCalculation.MedicationDose && (calculation.medicationCandidates.size != 1 || candidates.any { it.matchType == "fuzzy" })
    val selected = if(ids.size == 1) available.find { it.id == ids.single() } else null
    val b = selected?.search?.bindings
    return NativeCalculatorOpportunity(kind,candidates,if(!confirm && ids.size == 1) ids.single() else null,confirm,
        selected?.let { draft(it,it.search!!,analysis) } ?: emptyMap(),
        selected?.let { options(it,b?.formInputId) }.orEmpty(),selected?.let { options(it,b?.routeInputId) }.orEmpty(),selected?.let { options(it,b?.indicationInputId) }.orEmpty())
}
