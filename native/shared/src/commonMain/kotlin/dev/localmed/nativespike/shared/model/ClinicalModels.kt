package dev.localmed.nativespike.shared.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.ExperimentalSerializationApi

@Serializable
enum class QueryFactKind(val wire: String) {
    @SerialName("age") AGE("age"),
    @SerialName("sex") SEX("sex"),
    @SerialName("duration") DURATION("duration"),
    @SerialName("temperature") TEMPERATURE("temperature"),
    @SerialName("measurement") MEASUREMENT("measurement"),
    @SerialName("symptom") SYMPTOM("symptom"),
    @SerialName("investigation") INVESTIGATION("investigation"),
    @SerialName("medication") MEDICATION("medication"),
    @SerialName("location") LOCATION("location"),
    @SerialName("epidemiology") EPIDEMIOLOGY("epidemiology"),
    @SerialName("negative-finding") NEGATIVE_FINDING("negative-finding"),
    @SerialName("weight") WEIGHT("weight"),
    @SerialName("route") ROUTE("route"),
    @SerialName("dose-form") DOSE_FORM("dose-form"),
    @SerialName("strength") STRENGTH("strength"),
    @SerialName("frequency") FREQUENCY("frequency"),
    @SerialName("gestational-age") GESTATIONAL_AGE("gestational-age"),
    @SerialName("pregnancy") PREGNANCY("pregnancy"),
    @SerialName("organ-function") ORGAN_FUNCTION("organ-function"),
    @SerialName("allergy") ALLERGY("allergy");
}

@Serializable
enum class QueryFactPolarity(val wire: String) {
    @SerialName("positive") POSITIVE("positive"),
    @SerialName("negative") NEGATIVE("negative"),
    @SerialName("uncertain") UNCERTAIN("uncertain");
}

@Serializable
enum class SearchIntentKind(val wire: String) {
    @SerialName("diagnosis") DIAGNOSIS("diagnosis"),
    @SerialName("treatment") TREATMENT("treatment"),
    @SerialName("medication") MEDICATION("medication"),
    @SerialName("disease-reference") DISEASE_REFERENCE("disease-reference"),
    @SerialName("care-guidance") CARE_GUIDANCE("care-guidance"),
    @SerialName("administrative-reference") ADMINISTRATIVE_REFERENCE("administrative-reference"),
    @SerialName("mixed") MIXED("mixed"),
    @SerialName("unknown") UNKNOWN("unknown");
}

@Serializable
enum class SearchSuggestionField(val wire: String) {
    @SerialName("age") AGE("age"),
    @SerialName("sex") SEX("sex"),
    @SerialName("duration") DURATION("duration"),
    @SerialName("temperature") TEMPERATURE("temperature"),
    @SerialName("medications") MEDICATIONS("medications"),
    @SerialName("investigations") INVESTIGATIONS("investigations"),
    @SerialName("epidemiology") EPIDEMIOLOGY("epidemiology"),
    @SerialName("diagnosis") DIAGNOSIS("diagnosis"),
    @SerialName("severity") SEVERITY("severity"),
    @SerialName("control") CONTROL("control"),
    @SerialName("weight") WEIGHT("weight"),
    @SerialName("context") CONTEXT("context"),
    @SerialName("goal") GOAL("goal");
}

@Serializable
data class ClinicalTextRange(val start: Int,val end: Int)
@Serializable
data class QueryFact(val id: String,val kind: QueryFactKind,val label: String,val value: String,val normalizedValue: String,val unit: String?,val polarity: QueryFactPolarity,val range: ClinicalTextRange)
@Serializable
data class QueryClinicalContext(val age: List<QueryFact>,val gestationalAge: List<QueryFact>,val sex: List<QueryFact>,val duration: List<QueryFact>,val weight: List<QueryFact>,val route: List<QueryFact>,val doseForm: List<QueryFact>,val strength: List<QueryFact>,val frequency: List<QueryFact>,val measurements: List<QueryFact>,val positiveFindings: List<QueryFact>,val negativeFindings: List<QueryFact>,val currentMedicines: List<QueryFact>,val pregnancy: List<QueryFact>,val organFunction: List<QueryFact>,val allergies: List<QueryFact>)
@Serializable
data class QueryIntent(val primary: SearchIntentKind,val secondary: List<SearchIntentKind>,val confidence: Double,val matchedSignals: List<String>,val needsClarification: Boolean)
@Serializable
data class QueryMedicationCandidate(val canonicalTerm: String,val matchedText: String,val matchType: String)
@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("kind")
sealed interface QueryCalculation {
    @Serializable @SerialName("medication-dose")
    data class MedicationDose(val medicationCandidates: List<QueryMedicationCandidate>): QueryCalculation
    @Serializable @SerialName("infusion-volume")
    data object InfusionVolume: QueryCalculation
}
@Serializable
data class SearchSuggestion(val id: String,val field: SearchSuggestionField,val label: String,val insertion: String,val detail: String,val priority: Int,val kind: String)
@Serializable
data class QueryBranch(val id: String,val kind: QueryBranchKind,val label: String,val query: String,val normalizedQuery: String,val terms: List<String>,val weight: Double)
@Serializable
data class QueryAnalysis(val originalQuery: String,val normalizedQuery: String,val intent: QueryIntent,val calculation: QueryCalculation?=null,val facts: List<QueryFact>,val clinicalContext: QueryClinicalContext,val branches: List<QueryBranch>,val suggestions: List<SearchSuggestion>,val warnings: List<String>)
@Serializable
data class ClinicalQueryPlan(val analysis: QueryAnalysis,val branches: List<LexicalQueryBranchPlan>,val aliasMatches: List<String>,val terms: List<String>,val ftsQuery: String)

internal fun LexicalQueryBranchPlan.analysisBranch()=QueryBranch(id,kind,label,query,normalizedQuery,terms,weight)
