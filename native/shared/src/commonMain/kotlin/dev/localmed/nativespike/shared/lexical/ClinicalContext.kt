package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.QueryClinicalContext
import dev.localmed.nativespike.shared.model.QueryFact
import dev.localmed.nativespike.shared.model.QueryFactKind
import dev.localmed.nativespike.shared.model.QueryFactPolarity
import dev.localmed.nativespike.shared.text.normalizeSurfaceText
import dev.localmed.nativespike.shared.text.fixed6NumberString

private val NUMBER_WORDS=RUSSIAN_NUMBER_VALUES.keys.joinToString("|")
private val WEIGHT_AMOUNT="(?:\\d+(?:[.,]\\d+)?|(?:$NUMBER_WORDS)(?:\\s+(?:$NUMBER_WORDS)){0,2})"
private const val KILOGRAM_UNIT="(?:кг\\.?|килограмм(?:а|ов)?)"
private const val WEIGHT_UNIT="(?:кг\\.?|килограмм(?:а|ов)?|г\\.?|грамм(?:а|ов)?)"
private val WEIGHT_PATTERNS=listOf(
    clinicalRegex("(?:вес(?:ом)?|масс(?:а|ой|у|е)?)\\s*[:=]?\\s*(?:примерно\\s+|около\\s+|приблизительно\\s+)?($WEIGHT_AMOUNT)\\s*($WEIGHT_UNIT)"),
    clinicalRegex("(?:примерно|около|приблизительно)\\s+($WEIGHT_AMOUNT)\\s*($KILOGRAM_UNIT)(?=$|[^а-яёa-z])"),
    clinicalRegex("(?<![\\d.,а-яёa-z])($WEIGHT_AMOUNT)\\s*($KILOGRAM_UNIT)(?=$|[^а-яёa-z])"),
)
private val WEIGHT_TEXT=clinicalRegex("($WEIGHT_AMOUNT)\\s*($WEIGHT_UNIT)")
private fun weightAmount(amount: String,unit: String): String? {
    val value=normalizeSurfaceText(amount).replace(',','.')
    val number=if(clinicalRegex("^\\d+(?:\\.\\d+)?$").matches(value)) value.toDoubleOrNull() else {
        val tokens=value.split(' ').filter { it.isNotEmpty() }
        if(tokens.isEmpty() || tokens.any { it !in RUSSIAN_NUMBER_VALUES }) null else tokens.sumOf { RUSSIAN_NUMBER_VALUES.getValue(it) }.toDouble()
    } ?: return null
    if(!number.isFinite()) return null
    val normalizedUnit=normalizeSurfaceText(unit)
    val kg=if(normalizedUnit.startsWith("г")) number/1000 else number
    return "${fixed6NumberString(kg)} кг"
}
private fun weightContext(query: String,facts: List<QueryFact>): List<QueryFact> {
    val result=mutableListOf<QueryFact>()
    for(pattern in WEIGHT_PATTERNS) for(match in pattern.findAll(query)) {
        val value=weightAmount(match.capture(1),match.capture(2)) ?: continue
        result.addFact("weight","Масса",match.value,match.fullRange(),value,"кг",context=true)
    }
    for(fact in facts.filter { it.kind==QueryFactKind.MEASUREMENT && it.label=="Масса" }) {
        val match=WEIGHT_TEXT.find(fact.value) ?: continue
        val value=weightAmount(match.capture(1),match.capture(2)) ?: continue
        result.addFact("weight","Масса",fact.value,fact.range,value,"кг",fact.polarity,context=true)
    }
    return result
}
private fun doseForm(value: String): String {
    val normalized=normalizeSurfaceText(value)
    return when { normalized.startsWith("суспенз") -> "суспензия";normalized.startsWith("сироп") || normalized.startsWith("спироп") -> "сироп";normalized.startsWith("таблет") -> "таблетки";normalized.startsWith("маз") -> "мазь";else -> "капли" }
}
private fun strength(match: MatchResult): Pair<String,String> {
    val amount=match.capture(1).replace(',','.')
    val base=normalizeSurfaceText(match.capture(2));val denominator=match.capture(3).replace(',','.')
    val unit=normalizeSurfaceText(match.capture(4))
    val combined=if(unit.isNotEmpty()) "$base/${if(denominator.isNotEmpty()) "$denominator " else ""}$unit" else base
    return "$amount $combined" to combined
}
private fun strengthContext(query: String,facts: List<QueryFact>): List<QueryFact> {
    val result=mutableListOf<QueryFact>();val reserved=facts.ofKind("measurement").map { it.range }
    for((index,pattern) in listOf(STRENGTH_CONCENTRATION_PATTERN,STRENGTH_PERCENT_PATTERN,STRENGTH_VIAL_PATTERN,STRENGTH_AMOUNT_PATTERN).withIndex()) for(match in pattern.findAll(query)) {
        val (value,unit)=if(index==1) "${match.capture(1).replace(',','.')}%" to "%" else strength(match)
        result.addFact("strength","Сила/концентрация",match.value,match.fullRange(),value,unit,context=true,skip=reserved)
    }
    return result
}
private fun frequency(value: String): Pair<String,String?> {
    val normalized=normalizeSurfaceText(value).replace(clinicalRegex("\\s*-\\s*"),"-")
    if(clinicalRegex("(?:дважды|два\\s+раза)").containsMatchIn(normalized)) return "2 раза в сутки" to "раз/сут"
    clinicalRegex("^(\\d+(?:\\.\\d+)?)\\s*раз(?:а|у)?\\s+в\\s+").find(normalized)?.let { return "${it.capture(1)} раза в сутки" to "раз/сут" }
    return normalized to if(clinicalRegex("^каждые\\s+").containsMatchIn(normalized)) "ч" else null
}
private fun groupedContext(query: String,patterns: List<Regex>,kind: String,label: String,transform: (MatchResult)->Triple<String,String?,QueryFactPolarity>): List<QueryFact> {
    val result=mutableListOf<QueryFact>()
    for(pattern in patterns) for(match in pattern.findAll(query)) {
        val (normalized,unit,polarity)=transform(match)
        result.addFact(kind,label,match.captureOrNull(1) ?: match.value,groupRange(match,1),normalized,unit,polarity,context=true)
    }
    return result
}
internal fun buildClinicalContext(query: String,facts: List<QueryFact>): QueryClinicalContext {
    val route=mutableListOf<QueryFact>()
    for((pattern,value) in ROUTE_PATTERNS) for(match in pattern.findAll(query)) route.addFact("route","Путь введения",match.captureOrNull(1) ?: match.value,groupRange(match,1),value,context=true)
    val forms=groupedContext(query,listOf(DOSE_FORM_PATTERN),"dose-form","Лекарственная форма") { Triple(doseForm(it.captureOrNull(1) ?: it.value),null,QueryFactPolarity.POSITIVE) }
    val frequencies=mutableListOf<QueryFact>()
    for(pattern in FREQUENCY_PATTERNS) for(match in pattern.findAll(query)) {
        val (value,unit)=frequency(match.value);frequencies.addFact("frequency","Кратность",match.value,match.fullRange(),value,unit,context=true)
    }
    val gestational=groupedContext(query,GESTATIONAL_AGE_PATTERNS,"gestational-age","Срок беременности") {
        val amount=it.capture(2).toInt();val unit=pluralUnit(amount,listOf("неделя","недели","недель"));Triple("$amount $unit",unit,QueryFactPolarity.POSITIVE)
    }
    val pregnancy=groupedContext(query,listOf(PREGNANCY_PATTERN),"pregnancy","Беременность") {
        val value=normalizeSurfaceText(it.captureOrNull(1) ?: it.value)
        Triple("беременность",null,if(clinicalRegex("^(?:не\\s+|нет\\s+)|\\s+нет$").containsMatchIn(value)) QueryFactPolarity.NEGATIVE else QueryFactPolarity.POSITIVE)
    }
    val organs=groupedContext(query,listOf(ORGAN_FUNCTION_PATTERN),"organ-function","Функция органа") {
        val value=normalizeSurfaceText(it.captureOrNull(1) ?: it.value)
        val prefix=clinicalRegex("^(?:без|нет|не\\s+было|не\\s+наблюдается)\\s+");val suffix=clinicalRegex("\\s+(?:нет|не\\s+было|не\\s+наблюдается)$")
        val concept=value.replace(prefix,"").replace(suffix,"").replaceFirst(clinicalRegex("почечной\\s+недостаточности"),"почечная недостаточность").replaceFirst(clinicalRegex("печеночной\\s+недостаточности"),"печеночная недостаточность")
        Triple(concept,null,if(prefix.containsMatchIn(value) || suffix.containsMatchIn(value)) QueryFactPolarity.NEGATIVE else QueryFactPolarity.POSITIVE)
    }
    val allergies=groupedContext(query,listOf(ALLERGY_PATTERN),"allergy","Аллергия") {
        val value=normalizeSurfaceText(it.captureOrNull(1) ?: it.value)
        val negative=clinicalRegex("^(?:нет\\s+аллерги|аллерги(?:я|и)\\s+(?:нет|не\\s+было|не\\s+отмечается))").containsMatchIn(value)
        val concept=if(negative) "аллергия" else "аллергия на "+value.replaceFirst(clinicalRegex("^аллерги(?:я|и|ю|ией|иями)\\s+на\\s+"),"")
        Triple(concept,null,if(negative) QueryFactPolarity.NEGATIVE else QueryFactPolarity.POSITIVE)
    }
    return QueryClinicalContext(facts.ofKind("age"),gestational,facts.ofKind("sex"),facts.ofKind("duration"),weightContext(query,facts),route,forms,strengthContext(query,facts),frequencies,facts.ofKind("measurement"),facts.filter { it.polarity==QueryFactPolarity.POSITIVE && it.kind in setOf(QueryFactKind.SYMPTOM,QueryFactKind.TEMPERATURE,QueryFactKind.MEASUREMENT) },facts.filter { it.polarity==QueryFactPolarity.NEGATIVE },facts.ofKind("medication"),pregnancy,organs,allergies)
}
