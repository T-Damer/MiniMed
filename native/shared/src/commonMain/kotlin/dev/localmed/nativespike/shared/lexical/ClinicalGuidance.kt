package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.AliasExpansion
import dev.localmed.nativespike.shared.model.AliasMatchType
import dev.localmed.nativespike.shared.model.ClinicalTextRange
import dev.localmed.nativespike.shared.model.QueryCalculation
import dev.localmed.nativespike.shared.model.QueryClinicalContext
import dev.localmed.nativespike.shared.model.QueryFact
import dev.localmed.nativespike.shared.model.QueryIntent
import dev.localmed.nativespike.shared.model.QueryMedicationCandidate
import dev.localmed.nativespike.shared.model.SearchSuggestion
import dev.localmed.nativespike.shared.model.SearchSuggestionField
import dev.localmed.nativespike.shared.text.normalizeSurfaceText

internal fun clinicalCalculation(normalized: String,expansion: AliasExpansion,facts: List<QueryFact>,context: QueryClinicalContext): QueryCalculation? {
    val explicitDose=MEDICATION_DOSE_QUERY_PATTERNS.any { it.containsMatchIn(normalized) }
    val patient=context.age.isNotEmpty() || context.weight.isNotEmpty()
    if((explicitDose || patient) && MEDICATION_DOSE_EXCLUSION_PATTERNS.none { it.containsMatchIn(normalized) } && MEDICATION_INFORMATIONAL_QUERY_PATTERNS.none { it.containsMatchIn(normalized) }) {
        val negative=facts.ofKind("negative-finding").map { it.range }
        val candidates=linkedMapOf<String,QueryMedicationCandidate>()
        for(span in expansion.matchSpans) {
            if(span.alias.category!="medication" || negative.any { overlaps(it,ClinicalTextRange(span.range.start,span.range.end)) }) continue
            val text=slice(normalized,span.range.start,span.range.end);if(text.isEmpty()) continue
            val candidate=QueryMedicationCandidate(span.alias.canonicalTerm,text,if(span.matchType==AliasMatchType.EXACT) "exact" else "fuzzy")
            val key=normalizeSurfaceText(candidate.canonicalTerm);val current=candidates[key]
            if(current==null || current.matchType=="fuzzy" && candidate.matchType=="exact") candidates[key]=candidate
        }
        if(candidates.isNotEmpty()) return QueryCalculation.MedicationDose(candidates.values.toList())
    }
    val explicitInfusion=INFUSION_VOLUME_QUERY_PATTERNS.any { it.containsMatchIn(normalized) }
    val contextualInfusion=clinicalRegex("(?:^|[^а-яa-z])инфузи(?:я|и)(?=$|[^а-яa-z])").containsMatchIn(normalized) && patient
    return if((explicitInfusion || contextualInfusion) && INFUSION_VOLUME_EXCLUSION_PATTERNS.none { it.containsMatchIn(normalized) } && MEDICATION_INFORMATIONAL_QUERY_PATTERNS.none { it.containsMatchIn(normalized) }) QueryCalculation.InfusionVolume else null
}
internal fun clinicalWarnings(normalized: String,facts: List<QueryFact>): List<String> = buildList {
    if(clinicalRegex("(?:вроде|кажется|возможно|вероятно|со\\s+слов)").containsMatchIn(normalized)) add("В описании есть неопределённые формулировки; исходный текст сохранён без изменений.")
    if(facts.ofKind("temperature").size>1) add("Найдено несколько значений температуры; учитывайте временную последовательность.")
    if(normalized.length>4000) add("Описание длинное: поиск выполнен по нескольким независимым веткам.")
    if(clinicalRegex("(?:менингит.*энцефалит|энцефалит.*менингит|менингоэнцефалит)").containsMatchIn(normalized)) add("Менингит и энцефалит могут перекрываться по симптомам: уточнения показаны, но поиск по диагнозам уже выполнен.")
}
internal fun clinicalSuggestions(normalized: String,facts: List<QueryFact>,intent: QueryIntent): List<SearchSuggestion> {
    val suggestions=mutableListOf<SearchSuggestion>()
    fun add(field: String,label: String,insertion: String,priority: Int,kind: String="missing-field") {
        if(suggestions.none { it.id==field }) suggestions.add(SearchSuggestion(field,SearchSuggestionField.entries.single { it.wire==field },label,insertion,FIELD_DETAILS.getValue(field),priority,kind))
    }
    fun has(kind: String)=facts.ofKind(kind).isNotEmpty()
    val child=clinicalRegex("(?:ребен|ребён|мальчик|девоч|младен|\\b\\d+\\s*месяц)").containsMatchIn(normalized)
    val target=clinicalRegex("(?:лечени[ея]|терапи[яию]|при|для)\\s+[а-яa-z][а-яa-z-]{3,}").containsMatchIn(normalized)
    if(clinicalRegex("(?:менингит|энцефалит|менингоэнцефалит|нейроинфекц)").containsMatchIn(normalized)) {
        add("severity","Сознание и судороги","Сознание/судороги: ",118,"query-refinement")
        add("investigations","Менингеальные и очаговые признаки","Менингеальные/очаговые признаки: ",116,"query-refinement")
        add("context","Сыпь и гемодинамика","Сыпь/гемодинамика: ",108,"query-refinement")
    }
    val primary=intent.primary.wire
    if(primary in setOf("diagnosis","mixed")) {
        if(!has("age")) add("age","Возраст","Возраст: ",100)
        if(!has("duration")) add("duration","Длительность","Длительность: ",95)
        if(!has("temperature")) add("temperature","Температура","Температура: ",85)
        if(!has("sex")) add("sex","Пол","Пол: ",70)
        if(!has("investigation")) add("investigations","Обследования","Обследования: ",65)
        if(!has("medication")) add("medications","Препараты","Препараты: ",55)
        if(clinicalRegex("(?:сып|лихорад|инфекц|укус|диаре|кашл|контакт|клещ)\\w*").containsMatchIn(normalized) && !has("epidemiology")) add("epidemiology","Контакты и поездки","Эпидемиология: ",60)
    }
    if(primary in setOf("treatment","medication","mixed")) {
        if(!target) add("diagnosis","Диагноз или цель","Диагноз/цель: ",100)
        if(!has("age")) add("age","Возраст","Возраст: ",98)
        add("severity","Тяжесть","Тяжесть/красные флаги: ",88)
        if(normalized.contains("астм") && !clinicalRegex("(?:контрол|контол|обострен|ступен)").containsMatchIn(normalized)) add("control","Контроль заболевания","Контроль/ступень: ",92)
        if(!has("medication")) add("medications","Текущая терапия","Текущая терапия: ",75)
        if(child && facts.none { it.kind.wire=="measurement" && it.label=="Масса" }) add("weight","Масса","Масса: ",82)
        add("context","Ограничения","Аллергии/сопутствующие состояния: ",64)
    }
    if(primary=="medication") add("goal","Цель терапии","Цель терапии: ",90,"query-refinement")
    if(primary=="care-guidance") { if(!has("age")) add("age","Возраст","Возраст: ",100);add("context","Контекст","Тип вскармливания/особенности: ",74) }
    if(primary=="administrative-reference") { add("severity","Тяжесть и осложнения","Тяжесть/осложнения: ",100);add("context","Текущее состояние","Ремиссия/обострение/ограничения: ",92) }
    return suggestions.sortedByDescending { it.priority }.take(7)
}
