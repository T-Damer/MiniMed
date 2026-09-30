package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.AliasExpansion
import dev.localmed.nativespike.shared.model.AliasRecord
import dev.localmed.nativespike.shared.model.ClinicalQueryPlan
import dev.localmed.nativespike.shared.model.QueryAnalysis
import dev.localmed.nativespike.shared.model.analysisBranch
import dev.localmed.nativespike.shared.text.normalizeSurfaceText

/** Exact lexical clinical port; calculation proposals identify existing tools, never compute doses. */
fun analyzeClinicalQuery(query: String,aliases: List<AliasRecord>,includeSuggestions: Boolean=true,preparedExpansion: AliasExpansion?=null): ClinicalQueryPlan {
    val normalized=normalizeSurfaceText(query);val intent=classifyMedicalQueryIntent(query)
    val expansion=preparedExpansion ?: expandAliases(normalized,aliases)
    val facts=extractClinicalFacts(query,aliases,expansion);val context=buildClinicalContext(query,facts)
    val rawBranches=buildClinicalBranches(query,expansion,facts,context,intent)
    val analysis=QueryAnalysis(query,normalized,intent,clinicalCalculation(normalized,expansion,facts,context),facts,context,rawBranches.map { it.analysisBranch() },if(includeSuggestions) clinicalSuggestions(normalized,facts,intent) else emptyList(),clinicalWarnings(normalized,facts))
    val branches=diagnosticBranches(rawBranches,facts,intent)
    val wrapped=(intent.primary.wire=="diagnosis" && branches.isNotEmpty()) || (intent.primary.wire=="unknown" && branches.firstOrNull()?.id=="canonical-symptoms")
    val terms=branches.flatMap { it.terms }.distinct().let { if(wrapped) it else it.take(34) }
    return ClinicalQueryPlan(analysis,branches,expansion.matches,terms,branches.firstOrNull()?.ftsQuery.orEmpty())
}
