package dev.localmed.nativespike.shared.patient

import dev.localmed.nativespike.shared.tools.NativeToolInput
import kotlinx.serialization.json.*

internal val patientJson=Json { explicitNulls=false; ignoreUnknownKeys=true; allowSpecialFloatingPointValues=true }
private fun record(value: JsonElement?,message: String)=value as? JsonObject ?: throw IllegalArgumentException(message)
private fun required(record: JsonObject,key: String,label: String): String {
    val value=record[key] as? JsonPrimitive
    require(value?.isString==true&&value.content.patientTrim().isNotEmpty()) { "Повреждено поле $label." }
    return value.content
}
private fun optional(record: JsonObject,key: String,label: String,nullable: Boolean=false): String? {
    if(key !in record || (nullable&&record[key]==JsonNull))return null
    return required(record,key,label)
}
private fun validDate(value: JsonElement?,label: String): String {
    try { val primitive=value as? JsonPrimitive;require(primitive?.isString==true);return patientAsDate(primitive.content,label) }
    catch(cause: UnsupportedPatientDateFormat) { throw cause }
    catch(cause: IllegalArgumentException) { throw IllegalArgumentException("Повреждена дата: $label.",cause) }
}
private fun unique(ids: List<String>,label: String) { require(ids.distinct().size==ids.size) { "Дублируются идентификаторы: $label." } }
private fun strings(value: JsonElement?,label: String): List<String>? {
    if(value==null)return null
    require(value is JsonArray&&value.all { it is JsonPrimitive&&it.isString&&it.content.patientTrim().isNotEmpty() }) { "Повреждены $label." }
    return value.map { (it as JsonPrimitive).content }
}
internal fun readNativePatientValues(value: JsonElement?,label: String): NativePatientValues {
    val objectValue=record(value,"Повреждён $label.")
    return objectValue.mapValues { (key,entry)->
        val primitive=entry as? JsonPrimitive
        require(key.patientTrim().isNotEmpty()&&primitive!=null&&(primitive.isString||primitive.doubleOrNull?.isFinite()==true)) { "Повреждён $label." }
        if(primitive.isString)NativeToolInput.Text(primitive.content)else NativeToolInput.Number(primitive.double)
    }
}
fun decodeNativeCreatePatientProfileInput(value: JsonElement): NativeCreatePatientProfileInput {
    (value as? JsonObject)?.get("context")?.let { readNativePatientValues(it,"контекст пациента") }
    return patientJson.decodeFromJsonElement(value)
}
private fun normalizeProfile(value: JsonElement): NativePatientProfile {
    val r=record(value,"Повреждена карточка пациента.");val sex=r["biologicalSex"]
    require(sex==null||(sex is JsonPrimitive&&sex.isString&&sex.content in listOf("female","male","intersex","unknown"))) { "Поврежден биологический пол пациента." }
    val number=optional(r,"localRecordNumber","номер карты");val birth=optional(r,"birthDate","дата рождения");val summary=optional(r,"summary","описание")
    val context=r["context"]?.let { readNativePatientValues(it,"контекст пациента") }
    return NativePatientProfile(required(r,"id","идентификатор пациента"),required(r,"displayName","имя пациента"),validDate(r["createdAt"],"создания карточки"),validDate(r["updatedAt"],"изменения карточки"),r["avatar"]?.let {
        val avatar=record(it,"Некорректный значок пациента.");val kind=avatar["kind"] as? JsonPrimitive;val content=avatar["value"] as? JsonPrimitive
        require(kind?.isString==true&&content?.isString==true) { "Некорректный значок пациента." };normalizeNativePatientAvatar(NativePatientAvatar(kind.content,content.content))
    },number,birth?.let { validDate(JsonPrimitive(it),"дата рождения") },(sex as? JsonPrimitive)?.content,summary,context?.takeIf { it.isNotEmpty() })
}
private fun normalizeEpisode(value: JsonElement): NativeClinicalEpisode {
    val r=record(value,"Повреждён осмотр пациента.");val ids=r["eventIds"]
    require(ids is JsonArray) { "Повреждён осмотр пациента." }
    require(ids.all { it is JsonPrimitive&&it.isString }) { "Повреждены события осмотра." }
    val eventIds=ids.map { (it as JsonPrimitive).content };require(eventIds.distinct().size==eventIds.size) { "События осмотра повторяются." }
    val status=r["status"] ?: JsonPrimitive("closed")
    require(status is JsonPrimitive&&status.isString&&status.content in listOf("open","closed")) { "Поврежден статус осмотра." }
    val closedAt=r["closedAt"]?.let { validDate(it,"закрытия осмотра") }
    require(status.content!="open"||closedAt==null) { "Открытый осмотр не может иметь дату закрытия." }
    return NativeClinicalEpisode(required(r,"id","идентификатор осмотра"),required(r,"patientId","пациент осмотра"),required(r,"title","название осмотра"),validDate(r["startedAt"],"осмотра"),(r["text"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: "",eventIds,status.content,validDate(r["createdAt"],"создания осмотра"),validDate(r["updatedAt"],"изменения осмотра"),closedAt)
}
private fun normalizeMetric(value: JsonElement): NativePatientMetricDefinition {
    val r=record(value,"Повреждено определение показателя пациента.");val kind=r["kind"]
    require(kind is JsonPrimitive&&kind.isString&&kind.content in listOf("registry","custom")) { "Поврежден тип определения показателя." }
    return NativePatientMetricDefinition(required(r,"id","идентификатор определения показателя"),required(r,"metricId","идентификатор показателя"),required(r,"label","название показателя"),required(r,"unit","единица показателя"),required(r,"metricVersion","версия показателя"),kind.content,validDate(r["createdAt"],"создания определения показателя"))
}
private fun sourceSnapshots(value: JsonElement?,label: String): List<NativePatientSourceSnapshot>? {
    if(value==null)return null
    require(value is JsonArray) { "Повреждён $label." }
    return value.map { entry ->
        val r=record(entry,"Повреждён $label.");val module=optional(r,"moduleId","$label: модуль",true);val document=optional(r,"documentId","$label: документ",true);val url=optional(r,"url","$label: ссылка",true)
        require(url==null||nativePatientHttpUrl(url)) { "$label: ссылка должна использовать http или https." }
        NativePatientSourceSnapshot(required(r,"id","$label: идентификатор"),required(r,"title","$label: название"),module,document,url)
    }
}
private fun evaluation(value: JsonElement?): NativePatientEvaluationSnapshot? {
    if(value==null)return null
    val r=record(value,"Повреждён снимок оценки результата.");val status=r["status"] as? JsonPrimitive
    require(status!=null&&status.content in listOf("verdict","missing-context","unavailable","not-applicable")&&r["context"] is JsonObject) { "Повреждён снимок оценки результата." }
    val context=record(r["context"],"Повреждён снимок оценки результата.").mapValues { (_,entry)->
        val p=entry as? JsonPrimitive;require(p!=null&&(p.isString||p.doubleOrNull?.isFinite()==true)) { "Повреждён контекст оценки." };if(p.isString)NativeToolInput.Text(p.content)else NativeToolInput.Number(p.double)
    }
    val missing=strings(r["missingContext"],"недостающий контекст");val sources=strings(r["sourceIds"],"источники оценки");val links=sourceSnapshots(r["sourceLinks"],"снимок источников оценки");val reason=optional(r,"reason","причина оценки")
    val rawVerdict=r["verdict"]
    if(rawVerdict!=null)validatePatientVerdict(rawVerdict)
    require(status.content!="verdict"||rawVerdict!=null) { "Для оценки со статусом verdict нужен структурированный вердикт." }
    require(status.content=="verdict"||rawVerdict==null) { "Структурированный вердикт допустим только при статусе verdict." }
    return NativePatientEvaluationSnapshot(status.content,context,validDate(r["capturedAt"],"оценки"),rawVerdict?.let { patientJson.decodeFromJsonElement<NativePatientVerdict>(it) },missing,reason,sources,links)
}
private fun validatePatientVerdict(value: JsonElement) {
    val r=value as? JsonObject
    fun string(key: String)=r?.get(key)?.let { it is JsonPrimitive&&it.isString&&it.content.isNotEmpty() }==true
    fun number(key: String)=r?.get(key)?.let { it is JsonPrimitive&&!it.isString&&it.doubleOrNull?.isFinite()==true } ?: true
    fun bool(key: String)=r?.get(key)?.let { it is JsonPrimitive&&!it.isString&&it.booleanOrNull!=null } ?: true
    require(r!=null&&listOf("rangeId","title","explanation").all(::string)&&(r["attentionLevel"] as? JsonPrimitive)?.content in listOf("none","low","moderate","high","urgent")&&number("lowerBound")&&number("upperBound")&&bool("lowerInclusive")&&bool("upperInclusive")&&(r["sourceIds"]==null || (r["sourceIds"] is JsonArray&&(r["sourceIds"] as JsonArray).all { it is JsonPrimitive&&it.isString&&it.content.isNotEmpty() }))&&((r["lowerBound"] as? JsonPrimitive)?.doubleOrNull==null||(r["upperBound"] as? JsonPrimitive)?.doubleOrNull==null||(r["lowerBound"] as JsonPrimitive).double<=(r["upperBound"] as JsonPrimitive).double)) { "Повреждён структурированный вердикт." }
}
private fun laboratoryRange(value: JsonElement): NativeLaboratoryRange {
    val r=record(value,"Повреждён референсный диапазон лаборатории.")
    fun number(key: String,label: String): Double? { val p=r[key] ?: return null;require(p is JsonPrimitive&&!p.isString&&p.doubleOrNull?.isFinite()==true) { "Повреждена $label граница лаборатории." };return p.double }
    val lower=number("lower","нижняя");val upper=number("upper","верхняя")
    require(lower==null||upper==null||lower<=upper) { "Перепутаны границы лаборатории." }
    val text=optional(r,"text","текст диапазона")
    fun bool(key: String,label: String): Boolean? { val p=r[key] ?: return null;require(p is JsonPrimitive&&!p.isString&&p.booleanOrNull!=null) { "Повреждена $label граница лаборатории." };return p.boolean }
    return NativeLaboratoryRange(lower,upper,bool("lowerInclusive","нижняя"),bool("upperInclusive","верхняя"),text)
}
private fun observation(value: JsonElement): NativePatientObservation {
    val r=record(value,"Повреждено наблюдение пациента.");val number=r["value"] as? JsonPrimitive
    require(number!=null&&!number.isString&&number.doubleOrNull?.isFinite()==true&&r["source"]!=null&&r["source"]!=JsonNull&&(r["source"] is JsonObject||r["source"] is JsonArray)) { "Повреждено наблюдение пациента." }
    val source=r["source"] as? JsonObject ?: JsonObject(emptyMap());val kind=(source["kind"] as? JsonPrimitive)?.takeIf { it.isString }?.content
    val normalized=when(kind) {
        "tool-result"->NativePatientObservationSource.ToolResult(required(source,"toolId","инструмент"),required(source,"toolVersion","версия инструмента"))
        "manual"->NativePatientObservationSource.Manual(required(source,"label","показатель"),required(source,"metricVersion","версия показателя"))
        "laboratory"->NativePatientObservationSource.Laboratory(required(source,"label","лабораторный показатель"),source["reportRange"]?.let(::laboratoryRange))
        else->throw IllegalArgumentException("Поврежден источник наблюдения.")
    }
    val method=optional(r,"method","методика");val eval=evaluation(r["evaluation"]);val revision=optional(r,"revisionOf","исходное наблюдение");val superseded=optional(r,"supersededBy","заменившее наблюдение")
    return NativePatientObservation(required(r,"id","наблюдения"),required(r,"patientId","пациент наблюдения"),required(r,"eventId","событие наблюдения"),required(r,"metricId","показатель"),number.double,required(r,"unit","единица"),validDate(r["observedAt"],"наблюдения"),normalized,method,eval,revision,superseded)
}
private fun provenance(value: JsonElement): NativeToolResultProvenance {
    val r=record(value,"Повреждено происхождение результата.");val ids=r["sourceIds"]
    require(ids is JsonArray&&ids.all { it is JsonPrimitive&&it.isString&&it.content.patientTrim().isNotEmpty() }) { "Повреждено происхождение результата." }
    val links=sourceSnapshots(r["sourceLinks"],"снимок источников результата")
    return NativeToolResultProvenance(required(r,"toolId","инструмент"),required(r,"toolVersion","версия инструмента"),required(r,"definitionVersion","версия определения"),ids.map { (it as JsonPrimitive).content },required(r,"idempotencyKey","идентификатор результата"),readNativePatientValues(r["normalizedInputs"],"входы результата"),readNativePatientValues(r["contextSnapshot"],"снимок контекста"),links)
}
private fun event(value: JsonElement): NativePatientEvent {
    val r=record(value,"Повреждено событие пациента.");val observations=r["observations"];val immutable=r["immutable"] as? JsonPrimitive
    require(observations is JsonArray&&immutable!=null&&!immutable.isString&&immutable.booleanOrNull!=null) { "Повреждено событие пациента." }
    require(observations.all { it is JsonObject }) { "Повреждены наблюдения события." }
    val kind=(r["kind"] as? JsonPrimitive)?.takeIf { it.isString }?.content
    require(kind in listOf("tool-result","manual-measurement","laboratory-result","medication","note")) { "Поврежден тип события пациента." }
    val episode=optional(r,"episodeId","осмотр события");val text=optional(r,"text","текст события");val revision=optional(r,"revisionOf","исходное событие");val superseded=optional(r,"supersededBy","заменившее событие")
    val medication=(r["medicationKind"] as? JsonPrimitive)?.takeIf { it.isString }?.content
    require("medicationKind" !in r||medication in listOf("start","take","dose-change","stop")) { "Поврежден тип лекарственного события." }
    val provenance=r["provenance"]?.let(::provenance)
    require(kind!="tool-result"||(provenance!=null&&immutable.boolean)) { "Результат инструмента должен быть неизменяемым и иметь происхождение." }
    require(kind=="tool-result"||provenance==null) { "Происхождение результата допустимо только для события инструмента." }
    require(kind !in listOf("medication","note")||observations.isEmpty()) { "Лекарственное или текстовое событие не может содержать наблюдения." }
    require(kind=="medication"||medication==null) { "Тип лекарственного события указан не для лекарства." }
    return NativePatientEvent(required(r,"id","события"),required(r,"patientId","пациент события"),kind!!,validDate(r["occurredAt"],"события"),required(r,"title","название события"),observations.map(::observation),immutable.boolean,episode,text,medication,provenance,revision,superseded)
}
fun normalizeNativePatientSnapshot(value: JsonElement): NativePatientVaultSnapshot {
    val r=record(value,"Повреждён снимок пациентского хранилища.")
    require((r["schemaVersion"] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull==2.0) { "Неподдерживаемая версия пациентского хранилища." }
    fun array(key: String): JsonArray = r[key] as? JsonArray ?: throw IllegalArgumentException("Повреждён снимок пациентского хранилища.")
    val profileValues=array("profiles");val episodeValues=array("episodes");val eventValues=array("events");val observationValues=array("observations")
    val profiles=profileValues.map(::normalizeProfile);unique(profiles.map { it.id },"профили")
    val episodes=episodeValues.map(::normalizeEpisode);unique(episodes.map { it.id },"осмотры")
    val events=eventValues.map(::event);unique(events.map { it.id },"события")
    val observations=observationValues.map(::observation);unique(observations.map { it.id },"наблюдения")
    val definitions=r["metricDefinitions"]?.let { require(it is JsonArray) { "Повреждён справочник показателей пациента." };it.map(::normalizeMetric) } ?: emptyList()
    unique(definitions.map { it.id },"определения показателей");require(definitions.map { "${it.metricId}|${it.label}|${it.unit}" }.distinct().size==definitions.size) { "Определение показателя повторяется." }
    val profileIds=profiles.map { it.id }.toSet();val episodeIds=episodes.map { it.id }.toSet();val eventIds=events.map { it.id }.toSet();val observationIds=observations.map { it.id }.toSet()
    episodes.forEach { episode ->
        require(episode.patientId in profileIds&&episode.eventIds.all { it in eventIds }) { "Повреждены ссылки осмотра пациентского хранилища." }
        episode.eventIds.forEach { id->require(events.any { it.id==id&&it.patientId==episode.patientId&&it.episodeId==episode.id }) { "Повреждены ссылки осмотра пациентского хранилища." } }
    }
    val attached=mutableSetOf<String>()
    events.forEach { event ->
        require(event.patientId in profileIds&&(event.episodeId==null||event.episodeId in episodeIds)) { "Повреждены ссылки события пациентского хранилища." }
        listOfNotNull(event.revisionOf,event.supersededBy).forEach { relation->require(events.any { it.id==relation&&it.patientId==event.patientId&&it.id!=event.id }) { "Повреждены ссылки ревизии события." } }
        require(event.kind=="tool-result"||event.provenance==null) { "Происхождение результата допустимо только для события инструмента." }
        require(event.kind !in listOf("medication","note")||event.observations.isEmpty()) { "Лекарственное или текстовое событие не может содержать наблюдения." }
        require(event.episodeId==null||episodes.any { it.id==event.episodeId&&event.id in it.eventIds }) { "Повреждены ссылки события пациентского хранилища." }
        require(event.observations.all { it.id in observationIds&&it.eventId==event.id&&it.patientId==event.patientId }) { "Повреждены ссылки наблюдений события." }
        event.observations.forEach { o ->
            require(o.id !in attached) { "Наблюдение связано с несколькими событиями." };checkObservationKind(event,o)
            require(observations.find { it.id==o.id }==o) { "Данные наблюдения дублируются с разными значениями." };attached+=o.id
        }
    }
    observations.forEach { o ->
        require(o.patientId in profileIds&&o.eventId in eventIds) { "Повреждены ссылки наблюдения пациентского хранилища." }
        require(o.id in attached) { "Наблюдение не связано с событием." }
        listOfNotNull(o.revisionOf,o.supersededBy).forEach { relation->require(observations.any { it.id==relation&&it.patientId==o.patientId&&it.id!=o.id }) { "Повреждены ссылки ревизии наблюдения." } }
    }
    return NativePatientVaultSnapshot(profiles=profiles,episodes=episodes,events=events,observations=observations,metricDefinitions=definitions)
}
