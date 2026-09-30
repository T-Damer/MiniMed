package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.QueryIntent
import dev.localmed.nativespike.shared.model.SearchIntentKind
import dev.localmed.nativespike.shared.text.normalizeSurfaceText
import kotlin.math.abs

private data class MedicalSignal(val intent: SearchIntentKind,val pattern: Regex,val weight: Double,val label: String)
private val BASE_INTENTS=listOf(SearchIntentKind.DIAGNOSIS,SearchIntentKind.TREATMENT,SearchIntentKind.MEDICATION,SearchIntentKind.DISEASE_REFERENCE,SearchIntentKind.CARE_GUIDANCE,SearchIntentKind.ADMINISTRATIVE_REFERENCE)
private val SIGNALS=listOf(
    MedicalSignal(SearchIntentKind.ADMINISTRATIVE_REFERENCE,clinicalRegex("(?:групп[а-я]*\\s+здоровья|мсэ|инвалидност|диспансерн[а-я]*\\s+групп|справк[а-я]*)"),5.0,"административное правило"),
    MedicalSignal(SearchIntentKind.CARE_GUIDANCE,clinicalRegex("(?:вскармливан|прикорм|грудн[а-я]*\\s+молок|смес[ьи]|питани[ея]\\s+ребен|питани[ея]\\s+ребён)"),4.5,"вскармливание и прикорм"),
    MedicalSignal(SearchIntentKind.CARE_GUIDANCE,clinicalRegex("(?:прибавк[а-я]*\\s+(?:в\\s+)?вес|развити[ея]\\s+ребен|рост\\s+и\\s+вес)"),4.2,"рост и развитие"),
    MedicalSignal(SearchIntentKind.TREATMENT,clinicalRegex("(?:лечени[ея]|лечить|терапи[яию]|тактик[а-я]*\\s+лечен|неотложн[а-я]*\\s+помощ)"),4.5,"прямой запрос лечения"),
    MedicalSignal(SearchIntentKind.TREATMENT,clinicalRegex("(?:помощ[ьи]\\s+при|что\\s+делать\\s+при|обработать\\s+(?:ран|ожог|ссадин))"),4.2,"практическая помощь"),
    MedicalSignal(SearchIntentKind.TREATMENT,clinicalRegex("(?:маз[ьи]\\s+при|крем\\s+при|гель\\s+при|средств[оа]\\s+при)"),4.0,"местное лечение"),
    MedicalSignal(SearchIntentKind.TREATMENT,clinicalRegex("(?:нуж(?:ен|на|но|ны)\\s+ли|стоит\\s+ли|надо\\s+ли|требуется\\s+ли)(?:\\s+(?:ему|ей|реб[её]нку))?\\s+(?:антибиотик[а-я]*|антибактериальн[а-я]*(?:\\s+препарат[а-я]*)?|противовирусн[а-я]*(?:\\s+препарат[а-я]*)?|жаропонижающ[а-я]*)"),5.6,"решение о противомикробной или симптоматической терапии"),
    MedicalSignal(SearchIntentKind.TREATMENT,clinicalRegex("(?:(?:чем|как)\\s+(?:лучше\\s+)?(?:отпаивать|поить)|оральн[а-я]*\\s+регидратац[а-я]*)"),5.2,"практическая регидратация"),
    MedicalSignal(SearchIntentKind.MEDICATION,clinicalRegex("(?:препарат[а-я]*|лекарств[а-я]*|таблетк[а-я]*|маз[ьи]|крем|гель|капл[а-я]*|жаропонижающ[а-я]*)"),3.2,"поиск лекарственного средства"),
    MedicalSignal(SearchIntentKind.MEDICATION,clinicalRegex("(?:снизить|снижения|повысить|купировать)\\s+(?:давлен|температур|боль|тошнот)"),2.2,"фармакологическая цель"),
    MedicalSignal(SearchIntentKind.DIAGNOSIS,clinicalRegex("(?:как\\s+диагностировать\\s+дальше|что\\s+(?:обследовать|проверить)|какие\\s+(?:анализы|обследования)|диагностическ[а-я]*\\s+тактик)"),5.0,"следующий этап диагностики"),
    MedicalSignal(SearchIntentKind.DIAGNOSIS,clinicalRegex("(?:как\\s+отличить|чем\\s+отличается|дифференциальн[а-я]*\\s+диагноз\\s+с)"),5.0,"дифференциальный вопрос"),
    MedicalSignal(SearchIntentKind.DIAGNOSIS,clinicalRegex("(?:диагноз|дифференциальн|что\\s+это|на\\s+что\\s+похож|причин[а-я]*\\s+симптом)"),4.5,"прямой диагностический вопрос"),
    MedicalSignal(SearchIntentKind.DIAGNOSIS,clinicalRegex("(?:появил[а-я]*|жалоб[а-я]*|болеет|дн(?:я|ей)?\\s+назад|час(?:а|ов)?\\s+назад)"),2.3,"описание клинического случая"),
    MedicalSignal(SearchIntentKind.DIAGNOSIS,clinicalRegex("(?:сып[а-я]*|каш[а-я]*|лихорад[а-я]*|боль|рвот[а-я]*|диаре[а-я]*|одышк[а-я]*|зуд[а-я]*|вздут[а-я]*|метеоризм|судорог[а-я]*|ригидн[а-я]*|сознани[а-я]*)"),1.6,"симптомы"),
    MedicalSignal(SearchIntentKind.DISEASE_REFERENCE,clinicalRegex("(?:что\\s+такое|классификац|степен[ьи]\\s+тяжест|прогноз|осложнен|течени[ея]\\s+болезн)"),3.8,"справка о заболевании"),
    MedicalSignal(SearchIntentKind.DISEASE_REFERENCE,clinicalRegex("(?:симптом[ыа]|признак[иа]|клиническ[а-я]*\\s+картин)"),2.2,"справка о проявлениях")
)

fun classifyMedicalQueryIntent(query: String): QueryIntent {
    val normalized=normalizeSurfaceText(query).replace(clinicalRegex("\\bконтоля\\b"),"контроля").replace(clinicalRegex("\\bссаденой\\b"),"ссадиной")
    val scores=BASE_INTENTS.associateWith { 0.0 }.toMutableMap()
    val matched=SIGNALS.filter { it.pattern.containsMatchIn(normalized) }
    for(signal in matched) scores[signal.intent]=scores.getValue(signal.intent)+signal.weight
    val labels=matched.sortedByDescending { it.weight }.map { it.label }.distinct()
    if(clinicalRegex("\\b\\d{1,3}\\s*(?:дн|день|дня|дней|недел|месяц|месяца|месяцев|год|года|лет)\\b").containsMatchIn(normalized) && clinicalRegex("(?:появил|жалоб|болеет|сып|кашл|боль|температур)").containsMatchIn(normalized)) scores[SearchIntentKind.DIAGNOSIS]=scores.getValue(SearchIntentKind.DIAGNOSIS)+1.4
    if(clinicalRegex("\\b(?:и|плюс)\\b.*(?:лечени|диагноз)|(?:диагноз).*\\bи\\b.*(?:лечени)").containsMatchIn(normalized)) {
        scores[SearchIntentKind.DIAGNOSIS]=scores.getValue(SearchIntentKind.DIAGNOSIS)+2
        scores[SearchIntentKind.TREATMENT]=scores.getValue(SearchIntentKind.TREATMENT)+2
    }
    if(clinicalRegex("(?:принимает|получает|назначен[а-я]*).{0,100}(?:улучшен[а-я]*\\s+нет|эффект[а-я]*\\s+нет|не\\s+помог[а-я]*|неэффектив[а-я]*|что\\s+пересмотреть)").containsMatchIn(normalized)) scores[SearchIntentKind.TREATMENT]=scores.getValue(SearchIntentKind.TREATMENT)+4.8
    val ranked=BASE_INTENTS.sortedByDescending { scores.getValue(it) }
    val first=ranked.first();val second=ranked[1];val top=scores.getValue(first);val runnerUp=scores.getValue(second)
    if(top<=0) return QueryIntent(SearchIntentKind.UNKNOWN,emptyList(),.2,labels,true)
    val mixed=top>=3 && runnerUp>=3 && abs(top-runnerUp)<=.35
    val primary=if(mixed) SearchIntentKind.MIXED else first
    val secondary=ranked.filter { it!=first && scores.getValue(it)>0 && scores.getValue(it)>=top*.45 }.toMutableList()
    if(mixed) { secondary.add(0,second);secondary.add(0,first) }
    val confidence=minOf(.99,.5+top*.065+maxOf(0.0,top-runnerUp)*.03)
    val broadMedication=primary==SearchIntentKind.MEDICATION && clinicalRegex("(?:^|\\s)(?:препарат[а-я]*|лекарств[а-я]*|средств[оа])(?:\\s|$)").containsMatchIn(normalized)
    val target=clinicalRegex("(?:лечени[ея]|терапи[яию]|при|для)\\s+[а-яa-z][а-яa-z-]{3,}").containsMatchIn(normalized)
    val clarification=broadMedication || (primary==SearchIntentKind.TREATMENT && !target) || (primary==SearchIntentKind.ADMINISTRATIVE_REFERENCE && !clinicalRegex("(?:тяжест|осложнен|ремисс|обострен)").containsMatchIn(normalized)) || (primary==SearchIntentKind.DIAGNOSIS && normalized.length<12) || clinicalRegex("(?:менингит.*энцефалит|энцефалит.*менингит|менингоэнцефалит)").containsMatchIn(normalized)
    return QueryIntent(primary,secondary.distinct().filter { it!=primary },confidence,labels,clarification)
}
