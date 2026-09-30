package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.DocumentDescriptor
import dev.localmed.nativespike.shared.model.NativeSearchScope
import dev.localmed.nativespike.shared.model.QueryAnalysis
import dev.localmed.nativespike.shared.model.QueryFactKind
import dev.localmed.nativespike.shared.model.QueryFactPolarity
import dev.localmed.nativespike.shared.model.RankedGroup
import dev.localmed.nativespike.shared.model.SearchDocumentSummary
import dev.localmed.nativespike.shared.text.lightStemRussian
import dev.localmed.nativespike.shared.text.normalizeSurfaceText
import dev.localmed.nativespike.shared.text.tokenize

/** Actual ScopedMedicalCore source-family and declared tool/terminology admission. */
fun documentMatchesSearchScope(document: SearchDocumentSummary,scope: NativeSearchScope): Boolean {
    val d=document.descriptor ?: DocumentDescriptor(document.id,document.sourceType,document.title,null,null,null,null,false,null,false,null,document.navigationAliases,emptyList())
    if(scope==NativeSearchScope.PERSONAL) return false
    if(scope==NativeSearchScope.CALCULATORS) return searchResultDocumentKind(d)=="calculator"
    if(scope==NativeSearchScope.ASSESSMENTS) return searchResultDocumentKind(d)=="assessment"
    val conditionTypes=setOf("condition","disease","syndrome","symptom")
    if(scope==NativeSearchScope.CONDITIONS && document.terminology) return d.entityType in conditionTypes
    if(document.sourceType=="core_catalog_pointer") {
        if(scope==NativeSearchScope.CONDITIONS) return d.catalogFamily=="reference" && d.entityType in conditionTypes
        if(scope==NativeSearchScope.ALL || scope==NativeSearchScope.DIAGNOSIS) return true
        return when(d.catalogFamily) {
            "medication" -> scope==NativeSearchScope.MEDICATIONS
            "clinical" -> scope==NativeSearchScope.GUIDELINES
            "legal" -> scope==NativeSearchScope.LEGAL
            else -> false
        }
    }
    return when(scope) {
        NativeSearchScope.ALL,NativeSearchScope.DIAGNOSIS -> true
        NativeSearchScope.CONDITIONS -> document.sourceType in setOf("rls_mkb_reference","krasotaimedicina_reference")
        NativeSearchScope.GUIDELINES -> document.sourceType in setOf("clinical_recommendation","clinical_recommendation_summary","medical_reference","rls_mkb_reference")
        NativeSearchScope.MEDICATIONS -> document.sourceType in setOf("allmed_reference","official_drug_instruction","official_registry_summary")
        NativeSearchScope.LEGAL -> document.sourceType in setOf("regulatory_act","regulatory_act_summary")
        else -> false
    }
}

fun keepExplicitMedicationMatches(groups: List<RankedGroup>,analysis: QueryAnalysis?): List<RankedGroup> {
    val terms=analysis?.facts.orEmpty().filter { it.kind==QueryFactKind.MEDICATION && it.polarity!=QueryFactPolarity.NEGATIVE }
        .flatMap { tokenize(it.normalizedValue).flatMap { term -> listOf(term,lightStemRussian(term)) } }.toSet()
    if(terms.isEmpty()) return groups
    return groups.filter { group -> terms.any { normalizeSurfaceText(group.title).contains(it) } || group.results.any { result -> result.matchedTerms.any { lightStemRussian(normalizeSurfaceText(it)) in terms } } }
}

fun rankDiagnosisGroups(groups: List<RankedGroup>): List<RankedGroup> = groups.sortedBy { when(it.documentKind) { "clinical-recommendation" -> 0;"reference" -> 1;else -> 2 } }
