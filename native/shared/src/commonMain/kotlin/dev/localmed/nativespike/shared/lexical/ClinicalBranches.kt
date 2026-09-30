package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.AliasExpansion
import dev.localmed.nativespike.shared.model.AliasMatchType
import dev.localmed.nativespike.shared.model.ClinicalTextRange
import dev.localmed.nativespike.shared.model.LexicalQueryBranchPlan
import dev.localmed.nativespike.shared.model.QueryBranchKind
import dev.localmed.nativespike.shared.model.QueryClinicalContext
import dev.localmed.nativespike.shared.model.QueryFact
import dev.localmed.nativespike.shared.model.QueryFactPolarity
import dev.localmed.nativespike.shared.model.QueryIntent
import dev.localmed.nativespike.shared.text.lightStemRussian
import dev.localmed.nativespike.shared.text.normalizeSurfaceText
import dev.localmed.nativespike.shared.text.searchSubjectText
import dev.localmed.nativespike.shared.text.tokenize

private fun strengthPresentation(values: List<String>): String = values.map { value ->
    val normalized=normalizeSurfaceText(value);val parts=normalized.split(clinicalRegex("\\s*/\\s*"))
    val numerator=termsWithStems(listOf(parts.first())).filter { !it.contains(' ') }
    val denominator=parts.getOrNull(1)?.let { termsWithStems(listOf(it)).filter { term -> !term.contains(' ') && !clinicalRegex("^\\d+$").matches(term) } }.orEmpty()
    val terms=(numerator+denominator).distinct()
    if(terms.isNotEmpty()) terms.joinToString(" AND ",transform=::ftsToken) else ftsToken(normalized)
}.filter { it.isNotEmpty() }.joinToString(" OR ") { "($it)" }

internal fun buildClinicalBranches(query: String,expansion: AliasExpansion,facts: List<QueryFact>,context: QueryClinicalContext,intent: QueryIntent): List<LexicalQueryBranchPlan> {
    val normalized=normalizeSurfaceText(query)
    val negativeBase=facts.ofKind("negative-finding").flatMap { termsWithStems(listOf(it.normalizedValue)) }.distinct()
    val negative=(negativeBase+negativeBase.map(::lightStemRussian)).toSet()
    val measurements=facts.ofKind("measurement").flatMap { tokenize(it.normalizedValue) }.filter { clinicalRegex("^\\d+$").matches(it) }.toSet()
    val subject=searchSubjectText(query);val originalTerms=termsWithStems(listOf(subject),measurements)
    val positive=originalTerms.filter { it !in negative }
    val negativeRanges=facts.ofKind("negative-finding").map { it.range }
    val matches=expansion.matchSpans.filter { span -> negativeRanges.none { overlaps(it,ClinicalTextRange(span.range.start,span.range.end)) } }
    val exact=termsWithStems(matches.filter { it.matchType==AliasMatchType.EXACT }.map { it.alias.canonicalTerm })
    val fuzzy=termsWithStems(matches.filter { it.matchType==AliasMatchType.FUZZY }.flatMap { if(it.alias.category=="medication") listOf(it.alias.canonicalTerm,it.alias.alias) else listOf(it.alias.canonicalTerm) })
    val clinicalTerms=(positive+exact).distinct().take(34)
    val branches=mutableListOf<LexicalQueryBranchPlan>()
    val medicationAliases=matches.filter { it.matchType==AliasMatchType.EXACT && it.alias.category=="medication" && normalizeSurfaceText(it.alias.alias)!=normalizeSurfaceText(it.alias.canonicalTerm) }.map { it.alias.alias }
    val strength=context.strength.filter { it.polarity==QueryFactPolarity.POSITIVE }.map { it.normalizedValue }
    val groups=listOf(termsWithStems(medicationAliases),termsWithStems(context.doseForm.filter { it.polarity==QueryFactPolarity.POSITIVE }.map { it.normalizedValue }),termsWithStems(context.route.filter { it.polarity==QueryFactPolarity.POSITIVE }.map { it.normalizedValue }),termsWithStems(strength)+strength.map(::normalizeSurfaceText)).map { it.distinct() }
    val presentation=groups.mapIndexed { index,terms -> terms to if(index==3) strengthPresentation(strength) else terms.joinToString(" OR ",transform=::ftsToken) }.filter { it.first.isNotEmpty() && it.second.isNotEmpty() }
    if(presentation.size>1) branches.add(LexicalQueryBranchPlan("medication-presentation",QueryBranchKind.MEDICATION,"Точная форма препарата",query,normalized,presentation.flatMap { it.first }.distinct().take(34),1.7,presentation.joinToString(" AND ") { "(${it.second})" }))
    makeBranch("clinical",QueryBranchKind.CLINICAL,"Клинические признаки",query,clinicalTerms,if(intent.primary.wire=="diagnosis") 1.32 else 1.18,measurements)?.let(branches::add)
    if((tokenize(subject).size>=3 || subject!=normalized && tokenize(subject).size>=2) && negative.isEmpty()) branches.add(LexicalQueryBranchPlan("source-phrase",QueryBranchKind.ORIGINAL,"Точная фраза источника",query,normalized,positive,1.7,"\"${subject.replace("\"","\"\"")}\""))
    makeBranch("fuzzy-aliases",QueryBranchKind.CLINICAL,"Похожие клинические термины",fuzzy.joinToString(" "),fuzzy,.72)?.takeIf { exact.isEmpty() }?.let(branches::add)
    if(intent.primary.wire!="unknown") {
        val spec=INTENT_BRANCH.getValue(intent.primary.wire)
        makeBranch("intent",QueryBranchKind.INTENT,spec.label,query,listOf(subject,spec.terms),spec.weight,measurements)?.takeIf { b -> branches.none { it.ftsQuery==b.ftsQuery } }?.let(branches::add)
    }
    makeBranch("original",QueryBranchKind.ORIGINAL,"Исходная формулировка",query,positive,1.0,measurements)?.takeIf { b -> branches.none { it.ftsQuery==b.ftsQuery } }?.let(branches::add)
    val investigation=facts.filter { it.kind.wire=="investigation" || it.label=="Сатурация" }.map { it.normalizedValue }
    makeBranch("investigations",QueryBranchKind.INVESTIGATION,"Обследования",investigation.joinToString(" "),investigation,.95)?.let(branches::add)
    val medications=facts.ofKind("medication").map { it.normalizedValue }
    makeBranch("medications",QueryBranchKind.MEDICATION,"Препараты и терапия",medications.joinToString(" "),medications,1.05)?.let(branches::add)
    if(query.length>=100 || clinicalRegex("[.;\\n]").containsMatchIn(query)) {
        val clauses=query.split(clinicalRegex("[.;\\n]+")).map { it.trim() }.filter { it.length>=18 }.take(3)
        for((index,clause) in clauses.withIndex()) {
            if(clinicalRegex("^(?:без|нет|отрицает|не\\s+)").containsMatchIn(normalizeSurfaceText(clause))) continue
            makeBranch("clause-${index+1}",QueryBranchKind.CLAUSE,"Фрагмент ${index+1}",clause,listOf(clause),.82,measurements)?.takeIf { b -> branches.none { it.ftsQuery==b.ftsQuery } }?.let(branches::add)
        }
    }
    if(clinicalRegex("(?:как\\s+отличить|чем\\s+отличается|дифференциальн[а-я]*\\s+диагноз)").containsMatchIn(normalized)) makeBranch("differential",QueryBranchKind.INTENT,"Критерии дифференциальной диагностики",query,listOf(normalized,"дифференциальная диагностика отличия критерии"),1.38,measurements)?.let { branches.add(0,it) }
    if(clinicalRegex("(?:как\\s+диагностировать\\s+дальше|что\\s+(?:обследовать|проверить)|какие\\s+(?:анализы|обследования))").containsMatchIn(normalized)) makeBranch("next-diagnostics",QueryBranchKind.INTENT,"Следующий этап диагностики",query,listOf(normalized,"диагностика обследование лабораторная инструментальная"),1.4,measurements)?.let { branches.add(0,it) }
    val selected=branches.take(8).mapNotNull { branch ->
        val terms=branch.terms.filter { it !in negative && lightStemRussian(it) !in negative }
        when { terms.size==branch.terms.size -> branch;terms.isEmpty() -> null;else -> branch.copy(terms=terms,ftsQuery=terms.joinToString(" OR ",transform=::ftsToken)) }
    }
    if(intent.primary.wire!="medication" && !(intent.primary.wire=="unknown" && MEDICATION_INFORMATIONAL_QUERY_PATTERNS.any { it.containsMatchIn(normalized) })) return selected
    val names=facts.ofKind("medication").filter { it.polarity==QueryFactPolarity.POSITIVE }.flatMap { listOf(it.value,it.normalizedValue) }.distinct()
    val medicationQuery=names.map { name -> tokenize(normalizeSurfaceText(name)).joinToString(" AND ") { term -> "(${termsWithStems(listOf(term)).joinToString(" OR ",transform=::ftsToken)})" } }.filter { it.isNotEmpty() }.joinToString(" OR ") { "($it)" }
    return if(medicationQuery.isNotEmpty()) selected.map { it.copy(ftsQuery="(${it.ftsQuery}) AND ($medicationQuery)") } else selected
}

/** The diagnostic wrapper excludes medicine words without changing the raw clinical analysis. */
internal fun diagnosticBranches(branches: List<LexicalQueryBranchPlan>,facts: List<QueryFact>,intent: QueryIntent): List<LexicalQueryBranchPlan> {
    if(intent.primary.wire !in setOf("diagnosis","unknown")) return branches
    val medicationTerms=facts.ofKind("medication").flatMap { listOf(it.value,it.normalizedValue) }.flatMap { tokenize(it).flatMap { token -> listOf(token,lightStemRussian(token)) } }.toSet()
    val sanitized=if(intent.primary.wire=="diagnosis" && medicationTerms.isNotEmpty()) branches.mapNotNull { branch ->
        if(branch.kind==QueryBranchKind.MEDICATION || branch.id=="medications" || branch.kind==QueryBranchKind.CLAUSE && clinicalRegex("(?:принимает|получает|назначен[а-я]*|терапия)").containsMatchIn(branch.normalizedQuery)) null else {
            val terms=branch.terms.filter { it !in medicationTerms }
            if(terms.isEmpty()) null else branch.copy(terms=terms,ftsQuery=terms.joinToString(" OR ",transform=::ftsToken))
        }
    } else branches
    val values=facts.ofKind("symptom").filter { it.polarity==QueryFactPolarity.POSITIVE }.map { it.normalizedValue }
    val terms=values.flatMap { tokenize(it).filter { token -> token.length>=2 }.flatMap { token -> listOf(token,lightStemRussian(token)) } }.distinct()
    if(terms.isEmpty()) return sanitized.ifEmpty { branches }
    val query=values.joinToString(" ")
    val canonical=LexicalQueryBranchPlan("canonical-symptoms",QueryBranchKind.CLINICAL,"Распознанные симптомы",query,normalizeSurfaceText(query),terms,1.58,terms.joinToString(" OR ",transform=::ftsToken))
    return listOf(canonical)+sanitized.filter { it.ftsQuery!=canonical.ftsQuery }
}
