package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.AliasExpansion
import dev.localmed.nativespike.shared.model.AliasMatchType
import dev.localmed.nativespike.shared.model.AliasRecord
import dev.localmed.nativespike.shared.model.ClinicalTextRange
import dev.localmed.nativespike.shared.model.QueryFact
import dev.localmed.nativespike.shared.model.QueryFactKind
import dev.localmed.nativespike.shared.model.QueryFactPolarity
import dev.localmed.nativespike.shared.text.normalizeSurfaceText

internal fun groupRange(match: MatchResult,index: Int): ClinicalTextRange {
    val group=match.captureOrNull(index).orEmpty()
    val start=match.range.first+maxOf(match.value.indexOf(group),0)
    return ClinicalTextRange(start,start+group.length)
}
internal fun MatchResult.fullRange()=ClinicalTextRange(range.first,range.last+1)
internal fun MatchResult.captureOrNull(index: Int)=if(index<groups.size) groups[index]?.value else null
internal fun MatchResult.capture(index: Int)=captureOrNull(index).orEmpty()
internal fun overlaps(a: ClinicalTextRange,b: ClinicalTextRange)=a.start<b.end && b.start<a.end
internal fun slice(value: String,start: Int,end: Int=value.length)=value.substring(start.coerceIn(0,value.length),end.coerceIn(start.coerceIn(0,value.length),value.length))
internal fun fact(kind: String,label: String,value: String,range: ClinicalTextRange,normalized: String=value,unit: String?=null,polarity: QueryFactPolarity=QueryFactPolarity.POSITIVE): QueryFact? =
    if(range.end<=range.start) null else QueryFact("$kind:${range.start}:${range.end}",QueryFactKind.entries.single { it.wire==kind },label,value.trim(),normalizeSurfaceText(normalized),unit,polarity,range)
internal fun MutableList<QueryFact>.addFact(kind: String,label: String,value: String,range: ClinicalTextRange,normalized: String=value,unit: String?=null,polarity: QueryFactPolarity=QueryFactPolarity.POSITIVE,context: Boolean=false,skip: List<ClinicalTextRange> = emptyList()) {
    if(skip.any { overlaps(it,range) } || any { it.kind.wire==kind && if(context) overlaps(it.range,range) else it.range==range }) return
    fact(kind,label,value,range,normalized,unit,polarity)?.let(::add)
}
internal fun List<QueryFact>.ofKind(kind: String)=filter { it.kind.wire==kind }
internal fun pluralUnit(amount: Int,forms: List<String>): String = when {
    amount%10==1 && amount%100!=11 -> forms[0]
    amount%10 in 2..4 && (amount%100<10 || amount%100>=20) -> forms[1]
    else -> forms[2]
}

private fun extractAge(query: String,facts: MutableList<QueryFact>) {
    val protected=mutableListOf<ClinicalTextRange>()
    val months=listOf("месяц","месяца","месяцев")
    for((index,pattern) in AGE_PROTECTED.withIndex()) for(match in pattern.findAll(query)) {
        val range=groupRange(match,1)
        val amount=when(index) { 0 -> match.capture(2).toInt()*12+match.capture(3).toInt();1 -> 18;2 -> match.capture(2).toInt();else -> 0 }
        protected.add(range)
        val unit=if(index==3) null else pluralUnit(amount,months)
        facts.addFact("age",if(index==3) "Возрастной этап" else "Возраст",match.capture(1),range,if(index==3) "неонатальный период" else "$amount $unit",unit)
    }
    for(pattern in AGE_PATTERNS) for(match in pattern.findAll(query)) {
        val range=match.fullRange();if(protected.any { overlaps(it,range) }) continue
        val unit=match.captureOrNull(2) ?: if(match.value.contains("месяч")) "месяцев" else "лет"
        facts.addFact("age","Возраст",match.value,range,"${match.capture(1)} $unit",unit)
    }
    if(facts.ofKind("age").isEmpty() && clinicalRegex("(?:прикорм|вскармливан|прибавк[а-я]*\\s+(?:в\\s+)?вес)").containsMatchIn(query)) {
        for(match in clinicalRegex("в\\s+(\\d{1,3})\\s*(месяц(?:а|ев)?|лет|год(?:а|ов)?)(?=$|[\\s,.;!?])").findAll(query)) facts.addFact("age","Возраст",match.value,match.fullRange(),"${match.capture(1)} ${match.capture(2)}",match.captureOrNull(2))
    }
}
private fun extractDuration(query: String,facts: MutableList<QueryFact>) {
    val excluded=facts.ofKind("age").map { it.range }+GESTATIONAL_AGE_PATTERNS.flatMap { it.findAll(query).map { m -> groupRange(m,1) }.toList() }
    for(pattern in DURATION_PATTERNS) for(match in pattern.findAll(query)) {
        val range=ClinicalTextRange(if(match.capture(1).isNotEmpty()) groupRange(match,1).start else match.range.first,match.range.last+1)
        if(excluded.any { overlaps(it,range) }) continue
        val value=slice(query,range.start,range.end)
        facts.addFact("duration","Длительность",value,range,value.replace(clinicalRegex("\\s*[-–—−]\\s*"),"-"),match.captureOrNull(2))
    }
    for(match in clinicalRegex("(?:до\\s+еды|после\\s+еды|с\\s+рождения)").findAll(query)) facts.addFact("duration","Временная привязка",match.value,match.fullRange())
}
private fun extractMeasurements(query: String,facts: MutableList<QueryFact>) {
    val labels=listOf("Масса","Масса","Сатурация","ЧСС","ЧДД","АД","АД")
    val units=listOf(null,"кг","%","в мин","в мин","мм рт. ст.","мм рт. ст.")
    for((index,pattern) in MEASUREMENT_PATTERNS.withIndex()) for(match in pattern.findAll(query)) {
        val label=labels[index];val range=match.fullRange()
        if(label in listOf("Масса","АД") && facts.any { it.kind==QueryFactKind.MEASUREMENT && it.label==label && overlaps(it.range,range) }) continue
        val normalized=when(index) { 0,1 -> "${match.capture(1)} ${match.capture(2)}";2,3,4 -> match.captureOrNull(1) ?: match.value;5 -> "${match.capture(1)}/${match.capture(2)}";else -> match.value.replace(clinicalRegex("\\s+"),"") }
        facts.addFact("measurement",label,match.value,range,normalized,if(label=="Масса" && match.capture(2).isNotEmpty()) match.capture(2) else units[index])
    }
}
private fun trimNegation(captured: String,aliases: List<AliasRecord>): String {
    val normalized=normalizeSurfaceText(captured);var boundary=captured.length
    for(alias in aliases) {
        val index=findNormalizedPhraseIndex(normalized,normalizeSurfaceText(alias.alias));if(index<=0) continue
        val before=normalized.take(index).trimEnd()
        if(clinicalRegex("(?:^|\\s)(?:и|или|либо)$").containsMatchIn(before) || before.endsWith(',')) continue
        boundary=minOf(boundary,index)
    }
    for(pattern in listOf("\\s+(?:жалуется|принимает|получает|назначен[а-я]*|обследован[а-я]*|оак|оам|сатурац[а-я]*)(?=\\s|$)","\\s+(?:через|спустя)\\s+\\d+(?:[.,]\\d+)?(?:\\s*-\\s*\\d+(?:[.,]\\d+)?)?\\s*(?:минут[а-я]*|час[а-я]*|дн(?:я|ей|и)|сут(?:ок|ки)?|недел[а-я]*|месяц[а-я]*)(?=\\s|$)")) clinicalRegex(pattern).find(normalized)?.let { boundary=minOf(boundary,it.range.first) }
    return captured.take(boundary).split(clinicalRegex("\\s+(?:но|однако|при\\s+этом|а)\\s+")).first().trim()
}
private fun extractNegations(query: String,aliases: List<AliasRecord>,facts: MutableList<QueryFact>) {
    for(match in clinicalRegex("(?:без|нет|отрицает|не\\s+было|не\\s+отмечается|не\\s+отмечает|не\\s+наблюдается)\\s+([^,.;:—/\\n]{2,80})").findAll(query)) {
        val shortened=trimNegation(match.capture(1),aliases);if(shortened.isEmpty()) continue
        val range=groupRange(match,1)
        facts.addFact("negative-finding","Отрицательный признак",shortened,range.copy(end=range.start+shortened.length),polarity=QueryFactPolarity.NEGATIVE)
    }
    for(match in clinicalRegex("([^,.;:—/\\n]{2,50}?)\\s+(?:нет|не\\s+было|не\\s+отмечается|не\\s+наблюдается|не\\s+помог(?:ло|ла|ли)?|не\\s+принимал(?:а|и)?|не\\s+принима(?:ет|ют|ю|ешь|ете))(?=\\s*[,.;:—/\\n]|$)").findAll(query)) {
        val raw=match.capture(1);val value=raw.trim();if(value.isEmpty()) continue
        val start=groupRange(match,1).start+raw.length-raw.trimStart().length
        facts.addFact("negative-finding","Отрицательный признак",value,ClinicalTextRange(start,start+value.length),polarity=QueryFactPolarity.NEGATIVE)
    }
}
private fun encodeComponent(value: String): String = buildString {
    for(byte in value.encodeToByteArray()) {
        val b=byte.toInt() and 255;val c=b.toChar()
        if(c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c in "-_.!~*'()") append(c)
        else append('%').append("0123456789ABCDEF"[b/16]).append("0123456789ABCDEF"[b%16])
    }
}
private fun extractAliasFacts(query: String,expansion: AliasExpansion,facts: MutableList<QueryFact>) {
    val kinds=setOf("symptom","investigation","measurement","medication","location","epidemiology")
    for(match in expansion.matchSpans) {
        val alias=match.alias;val kind=alias.category ?: continue
        if(match.matchType!=AliasMatchType.EXACT || kind !in kinds) continue
        val range=ClinicalTextRange(match.range.start,match.range.start+alias.alias.length)
        if(facts.any { it.kind==QueryFactKind.NEGATIVE_FINDING && overlaps(it.range,range) }) continue
        val normalizedAlias=normalizeSurfaceText(alias.alias)
        val ambiguous=expansion.matchSpans.map { it.alias }.filter { normalizeSurfaceText(it.alias)==normalizedAlias }.map { normalizeSurfaceText(it.canonicalTerm) }.distinct().size>1
        val value=slice(query,range.start,range.end);val label=if(kind=="medication") "Препарат" else "Распознанный термин"
        if(ambiguous) {
            val fact=fact(kind,label,value,range,alias.canonicalTerm,polarity=QueryFactPolarity.UNCERTAIN) ?: continue
            val id=fact.id+":"+encodeComponent(normalizeSurfaceText(alias.canonicalTerm))
            if(facts.none { it.id==id }) facts.add(fact.copy(id=id))
        } else facts.addFact(kind,label,value,range,alias.canonicalTerm)
    }
}
private fun extractSymptomFacts(query: String,facts: MutableList<QueryFact>) {
    val negative=facts.ofKind("negative-finding").map { it.range }
    val expressions=SYMPTOM_EXPRESSIONS.flatMap { entry -> entry.phrases.map { phrase ->
        val escaped=buildString { for(c in phrase) append(when { c=='е' || c=='ё' -> "[её]";c in ".*+?^$"+"{}()|[]\\" -> "\\$c";c.isWhitespace() -> "\\s+";else -> c.toString() }) }
        Triple(clinicalRegex("(?:^|[^а-яёa-z])($escaped)(?=$|[^а-яёa-z])"),entry.canonical,entry.label)
    } }+SYMPTOM_PATTERNS
    for((pattern,canonical,label) in expressions) for(match in pattern.findAll(query)) {
        val range=groupRange(match,1);if(negative.any { overlaps(it,range) }) continue
        facts.addFact("symptom",label,match.captureOrNull(1) ?: match.value,range,canonical)
    }
}
internal fun extractClinicalFacts(query: String,aliases: List<AliasRecord>,expansion: AliasExpansion): List<QueryFact> {
    val facts=mutableListOf<QueryFact>()
    for((pattern,value) in SEX_PATTERNS) {
        val match=pattern.find(query) ?: continue
        facts.addFact("sex","Пол",match.value,match.fullRange(),value);break
    }
    extractAge(query,facts)
    for(pattern in TEMPERATURE_PATTERNS) for(match in pattern.findAll(query)) facts.addFact("temperature","Температура",match.value,match.fullRange(),(match.captureOrNull(1) ?: match.value).replace(',','.'),"°C")
    extractDuration(query,facts);extractMeasurements(query,facts);extractNegations(query,aliases,facts);extractSymptomFacts(query,facts);extractAliasFacts(query,expansion,facts)
    val normalized=normalizeSurfaceText(query)
    for((kind,label,terms) in listOf(Triple("investigation","Обследование",INVESTIGATION_TERMS),Triple("epidemiology","Эпидемиология",EPIDEMIOLOGY_TERMS))) for(term in terms) {
        val index=normalized.indexOf(term);if(index<0) continue
        facts.addFact(kind,label,slice(query,index,index+term.length),ClinicalTextRange(index,index+term.length),term)
    }
    for(match in clinicalRegex("(?:принимает|получает|назначен(?:а|о|ы)?|терапия\\s*[:=]?)\\s+([а-яa-z][а-яa-z-]+(?:\\s+[а-яa-z][а-яa-z-]+){0,2})").findAll(query)) {
        val value=match.capture(1).split(clinicalRegex("\\s+(?:и|но|по|при)\\s+")).first().trim();if(value.length<3) continue
        val start=groupRange(match,1).start
        facts.addFact("medication","Терапия",value,ClinicalTextRange(start,start+value.length))
    }
    return facts.sortedBy { it.range.start }
}
