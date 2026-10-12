package dev.localmed.nativespike.shared.patient

import dev.localmed.nativespike.shared.tools.NativeToolInput
import dev.localmed.nativespike.shared.tools.NativeToolPatientBinding
import dev.localmed.nativespike.shared.tools.ToolDate
import dev.localmed.nativespike.shared.tools.toolNumericInput
import kotlinx.serialization.json.JsonElement

/** Schema 2 operations. Historical observations and evaluations are copied, never recalculated. */
class NativePatientDomain(private val context: NativePatientContext) {
    private fun id(prefix: String) = "$prefix-${context.randomUuid()}"
    fun emptyPatientVaultSnapshot() = NativePatientVaultSnapshot()
    fun createPatientProfile(input: NativeCreatePatientProfileInput): NativeCreatedPatientProfile {
        val at = input.createdAt ?: context.nowIso(); patientAsDate(at, "Дата создания карточки")
        val name = patientNonEmpty(input.displayName, "Отображаемое имя пациента")
        input.birthDate?.takeIf { it.isNotEmpty() }?.let { patientAsDate(it, "Дата рождения") }
        input.context?.let { validatePatientValues(it, "контекст пациента") }
        val profile = NativePatientProfile(input.id ?: id("patient"), name, at, at,
            input.avatar?.let(::normalizeNativePatientAvatar), input.localRecordNumber?.patientTrim()?.takeIf(String::isNotEmpty),
            input.birthDate?.takeIf(String::isNotEmpty), input.biologicalSex?.takeIf(String::isNotEmpty),
            input.summary?.patientTrim()?.takeIf(String::isNotEmpty), input.context?.takeIf { it.isNotEmpty() })
        val events = mutableListOf<NativePatientEvent>()
        input.weightKg?.let { events += createManualMeasurementEvent(NativeCreateMeasurementInput(profile.id,"body-mass","Масса тела",patientPositive(it,"Масса тела"),"кг",occurredAt=at)) }
        input.heightCm?.let { events += createManualMeasurementEvent(NativeCreateMeasurementInput(profile.id,"body-height","Рост",patientPositive(it,"Рост"),"см",occurredAt=at)) }
        return NativeCreatedPatientProfile(profile, events)
    }
    fun createClinicalEpisode(input: NativeCreateClinicalEpisodeInput): NativeClinicalEpisode {
        val at = input.startedAt ?: context.nowIso(); patientAsDate(at,"Дата осмотра")
        return NativeClinicalEpisode(input.id ?: id("episode"), patientNonEmpty(input.patientId,"Пациент"), input.title?.patientTrim()?.takeIf(String::isNotEmpty) ?: "Осмотр", at, input.text?.patientTrim() ?: "", emptyList(),"open",at,at)
    }
    fun closeClinicalEpisode(snapshot: NativePatientVaultSnapshot, episodeId: String, closedAt: String = context.nowIso()): NativePatientVaultSnapshot {
        patientAsDate(closedAt,"Дата закрытия осмотра")
        require(snapshot.episodes.any { it.id == episodeId }) { "Осмотр не найден." }
        return snapshot.copy(episodes=snapshot.episodes.map { if(it.id==episodeId) it.copy(status="closed",closedAt=closedAt,updatedAt=closedAt) else it })
    }
    fun calculateAgeOnDate(birthDate: String, eventDate: String): NativePatientAge {
        patientAsDate(birthDate,"Дата рождения"); patientAsDate(eventDate,"Дата события")
        fun date(value: String): ToolDate {
            val part=value.take(10); val match=Regex("^([0-9]{4})-([0-9]{2})-([0-9]{2})$").matchEntire(part)
                ?: throw IllegalArgumentException("Дата рождения или дата события имеет неверный календарный формат.")
            return ToolDate(match.groupValues[1].toInt(),match.groupValues[2].toInt(),match.groupValues[3].toInt())
        }
        val birth=date(birthDate); val event=date(eventDate)
        require(event.epochDay >= birth.epochDay) { "Дата события раньше даты рождения." }
        var years=event.year-birth.year; var months=event.month-birth.month; var days=event.day-birth.day
        if(days<0) { months--; days+=patientMonthDays(if(event.month==1)event.year-1 else event.year,if(event.month==1)12 else event.month-1) }
        if(months<0) { years--; months+=12 }
        return NativePatientAge(years,months,days)
    }
    fun ageInYearsOnDate(birthDate: String,eventDate: String): Double = calculateAgeOnDate(birthDate,eventDate).let { it.years + it.months / 12.0 + it.days / 365.2425 }
    fun createManualMeasurementEvent(input: NativeCreateMeasurementInput): NativePatientEvent {
        val at=input.occurredAt ?: context.nowIso(); patientAsDate(at,"Дата измерения"); val eventId=input.id ?: id("event")
        val observation=NativePatientObservation(id("observation"),patientNonEmpty(input.patientId,"Пациент"),eventId,patientNonEmpty(input.metricId,"Показатель"),patientFinite(input.value,input.label),patientNonEmpty(input.unit,"Единица"),at,
            NativePatientObservationSource.Manual(patientNonEmpty(input.label,"Название показателя"),"1"),input.method?.takeIf(String::isNotEmpty))
        return NativePatientEvent(eventId,input.patientId,"manual-measurement",at,input.label.patientTrim(),listOf(observation),false,input.episodeId?.takeIf(String::isNotEmpty))
    }
    fun createLaboratoryEvent(input: NativeCreateMeasurementInput): NativePatientEvent {
        val base=createManualMeasurementEvent(input); val observation=base.observations.first()
        val range=input.reportRange
        val evaluation=if(range==null) NativePatientEvaluationSnapshot("unavailable",emptyMap(),observation.observedAt,reason="Референсный диапазон с бланка не указан.",missingContext=listOf("Референсный диапазон с бланка"),sourceIds=emptyList())
        else if(range.lower==null&&range.upper==null) NativePatientEvaluationSnapshot("unavailable",emptyMap(),observation.observedAt,reason="Введённый текст диапазона не содержит числовых границ.",missingContext=listOf("Числовые границы диапазона"),sourceIds=emptyList())
        else {
            val lowerInclusive=range.lowerInclusive ?: true; val upperInclusive=range.upperInclusive ?: true
            val below=range.lower?.let { observation.value<it || (!lowerInclusive&&observation.value==it) } ?: false
            val above=range.upper?.let { observation.value>it || (!upperInclusive&&observation.value==it) } ?: false
            NativePatientEvaluationSnapshot("verdict",emptyMap(),observation.observedAt,
                verdict=NativePatientVerdict("laboratory-report-range",if(below)"Ниже диапазона бланка" else if(above)"Выше диапазона бланка" else "В диапазоне бланка",
                    range.text?.patientTrim()?.takeIf(String::isNotEmpty) ?: "Оценка выполнена только по референсному диапазону с бланка.",if(below||above)"moderate" else "none",range.lower,range.upper,lowerInclusive,upperInclusive,emptyList()),missingContext=emptyList(),sourceIds=emptyList())
        }
        return base.copy(kind="laboratory-result",observations=listOf(observation.copy(source=NativePatientObservationSource.Laboratory(input.label.patientTrim(),range),evaluation=evaluation)))
    }
    fun createMedicationEvent(input: NativeCreateMedicationInput): NativePatientEvent {
        val at=input.occurredAt ?: context.nowIso(); patientAsDate(at,"Дата лекарственного события")
        return NativePatientEvent(input.id ?: id("event"),patientNonEmpty(input.patientId,"Пациент"),"medication",at,patientNonEmpty(input.title,"Препарат"),emptyList(),false,input.episodeId?.takeIf(String::isNotEmpty),input.text?.patientTrim()?.takeIf(String::isNotEmpty),input.medicationKind)
    }
    fun appendEvent(snapshot: NativePatientVaultSnapshot,event: NativePatientEvent): NativePatientVaultSnapshot = appendEventInternal(snapshot,event,false)
    private fun appendEventInternal(snapshot: NativePatientVaultSnapshot,event: NativePatientEvent,allowRevision: Boolean): NativePatientVaultSnapshot {
        if(snapshot.events.any { it.id==event.id }) return snapshot
        require(snapshot.profiles.any { it.id==event.patientId }) { "Нельзя записать событие неизвестному пациенту." }
        event.episodeId?.takeIf(String::isNotEmpty)?.let { episodeId ->
            val episode=snapshot.episodes.find { it.id==episodeId } ?: throw IllegalArgumentException("Нельзя записать событие в неизвестный осмотр.")
            require(episode.patientId==event.patientId) { "Нельзя записать событие в осмотр другого пациента." }
            val original=snapshot.events.find { it.id==event.revisionOf }
            val revision=event.revisionOf!=null&&!event.immutable&&original!=null&&!original.immutable&&original.kind in listOf("manual-measurement","laboratory-result")&&original.kind==event.kind&&original.patientId==event.patientId&&original.episodeId==episode.id&&original.supersededBy==event.id
            require(episode.status=="open" || (allowRevision&&revision)) { "Нельзя записать событие в закрытый осмотр." }
        }
        require(event.kind=="tool-result" || event.provenance==null) { "Происхождение результата допустимо только для события инструмента." }
        require(event.kind !in listOf("medication","note") || event.observations.isEmpty()) { "Лекарственное или текстовое событие не может содержать наблюдения." }
        val ids=mutableSetOf<String>()
        event.observations.forEach { o ->
            require(o.id.patientTrim().isNotEmpty()&&ids.add(o.id)&&snapshot.observations.none { it.id==o.id }&&o.eventId==event.id&&o.patientId==event.patientId&&o.metricId.patientTrim().isNotEmpty()&&o.unit.patientTrim().isNotEmpty()&&o.value.isFinite()) { "Наблюдение не связано с событием или имеет некорректные данные." }
            checkObservationKind(event,o)
        }
        require(event.kind!="tool-result" || (event.immutable&&event.provenance!=null)) { "Результат инструмента должен быть неизменяемым и иметь происхождение." }
        val (versioned,definitions)=withManualMetricVersion(snapshot,event)
        return snapshot.copy(events=snapshot.events+versioned,observations=snapshot.observations+versioned.observations,metricDefinitions=definitions,
            episodes=snapshot.episodes.map { if(it.id==versioned.episodeId)it.copy(eventIds=it.eventIds+versioned.id,updatedAt=versioned.occurredAt)else it })
    }
    private fun withManualMetricVersion(snapshot: NativePatientVaultSnapshot,event: NativePatientEvent): Pair<NativePatientEvent,List<NativePatientMetricDefinition>> {
        if(event.kind!="manual-measurement") return event to snapshot.metricDefinitions
        val definitions=snapshot.metricDefinitions.toMutableList()
        val observations=event.observations.map { o ->
            val source=o.source as? NativePatientObservationSource.Manual ?: return@map o
            val registry=NATIVE_PATIENT_METRIC_REGISTRY.find { it.metricId==o.metricId&&it.label==source.label&&it.unit==o.unit }
            val same=definitions.find { it.metricId==o.metricId&&it.label==source.label&&it.unit==o.unit }
            val prior=definitions.filter { it.metricId==o.metricId&&it.label==source.label }.map { toolNumericInput(NativeToolInput.Text(it.metricVersion)).let { value->if(value.isNaN()||value==0.0)1.0 else value } }
            val version=same?.metricVersion ?: registry?.metricVersion ?: patientJsVersion((prior.maxOrNull()?.coerceAtLeast(0.0) ?: 0.0)+1)
            if(same==null) definitions+=NativePatientMetricDefinition(listOf(o.metricId,source.label,o.unit,version).joinToString(":",transform=::patientEncodeUriComponent),o.metricId,source.label,o.unit,version,if(registry!=null)"registry" else "custom",o.observedAt)
            o.copy(source=source.copy(metricVersion=version))
        }
        return event.copy(observations=observations) to definitions
    }
    fun appendEpisode(snapshot: NativePatientVaultSnapshot,episode: NativeClinicalEpisode): NativePatientVaultSnapshot {
        require(snapshot.profiles.any { it.id==episode.patientId }) { "Нельзя создать осмотр неизвестному пациенту." }
        if(snapshot.episodes.any { it.id==episode.id })return snapshot
        episode.eventIds.forEach { id -> require(snapshot.events.any { it.id==id&&it.patientId==episode.patientId&&it.episodeId==episode.id }) { "Осмотр содержит событие другого пациента или неизвестное событие." } }
        return snapshot.copy(episodes=snapshot.episodes+episode)
    }
    fun removePatientFromSnapshot(snapshot: NativePatientVaultSnapshot,patientId: String): NativePatientVaultSnapshot {
        require(snapshot.profiles.any { it.id==patientId }) { "Пациент не найден." }
        val removedIds=snapshot.events.filter { it.patientId==patientId }.map { it.id }.toSet();val events=snapshot.events.filterNot { it.patientId==patientId }
        return snapshot.copy(profiles=snapshot.profiles.filterNot { it.id==patientId },episodes=snapshot.episodes.filterNot { it.patientId==patientId },events=events,observations=snapshot.observations.filterNot { it.patientId==patientId||it.eventId in removedIds },metricDefinitions=metricDefinitionsForEvents(snapshot,events))
    }
    fun selectPatientFromSnapshot(snapshot: NativePatientVaultSnapshot,patientId: String): NativePatientVaultSnapshot {
        require(snapshot.profiles.any { it.id==patientId }) { "Пациент не найден." }; val events=snapshot.events.filter { it.patientId==patientId };val ids=events.map { it.id }.toSet()
        return snapshot.copy(profiles=snapshot.profiles.filter { it.id==patientId },episodes=snapshot.episodes.filter { it.patientId==patientId },events=events,observations=snapshot.observations.filter { it.patientId==patientId&&it.eventId in ids },metricDefinitions=metricDefinitionsForEvents(snapshot,events))
    }
    fun createToolResultEvent(input: NativeCreateToolResultInput): NativePatientEvent {
        val at=input.occurredAt ?: context.nowIso(); val eventId=input.id ?: id("event")
        val patientId=patientNonEmpty(input.patientId,"Пациент");val title=patientNonEmpty(input.title,"Результат")
        val observations=input.observations.map { NativePatientObservation(id("observation"),input.patientId,eventId,it.metricId,it.value,it.unit,it.observedAt,it.source,it.method,it.evaluation,it.revisionOf,it.supersededBy) }
        return NativePatientEvent(eventId,patientId,"tool-result",at,title,observations,true,input.episodeId?.takeIf(String::isNotEmpty),input.text?.patientTrim()?.takeIf(String::isNotEmpty),provenance=input.provenance)
    }
    fun appendToolResultIdempotently(snapshot: NativePatientVaultSnapshot,input: NativeCreateToolResultInput): NativeAppendToolResult {
        snapshot.events.find { it.provenance?.idempotencyKey==input.provenance.idempotencyKey }?.let { existing ->
            require(existing.patientId==input.patientId&&existing.provenance?.toolId==input.provenance.toolId&&existing.provenance.toolVersion==input.provenance.toolVersion&&existing.provenance.definitionVersion==input.provenance.definitionVersion) { "Идентификатор результата уже используется другим инструментом или пациентом." }
            return NativeAppendToolResult(snapshot,existing,false)
        }
        val event=createToolResultEvent(input);return NativeAppendToolResult(appendEvent(snapshot,event),event,true)
    }
    fun reviseManualObservation(snapshot: NativePatientVaultSnapshot,observationId: String,input: NativeReviseObservationInput): NativePatientVaultSnapshot {
        val current=snapshot.observations.find { it.id==observationId } ?: throw IllegalArgumentException("Наблюдение не найдено.")
        require(current.supersededBy==null) { "Нельзя изменить уже заменённое наблюдение." }
        val event=snapshot.events.find { it.id==current.eventId }
        require(event!=null&&!event.immutable&&current.source !is NativePatientObservationSource.ToolResult) { "Результат инструмента неизменяем." }
        val label=when(val source=current.source){is NativePatientObservationSource.Manual->source.label;is NativePatientObservationSource.Laboratory->source.label;else->error("unreachable")}
        val measurement=NativeCreateMeasurementInput(current.patientId,current.metricId,label,input.value,input.unit ?: current.unit,event.episodeId,input.occurredAt ?: context.nowIso(),current.method,reportRange=(current.source as? NativePatientObservationSource.Laboratory)?.reportRange)
        val revised=if(current.source is NativePatientObservationSource.Laboratory)createLaboratoryEvent(measurement)else createManualMeasurementEvent(measurement)
        val superseded=current.copy(supersededBy=revised.observations.first().id)
        val oldEvent=event.copy(supersededBy=revised.id,observations=event.observations.map { if(it.id==current.id)superseded else it })
        return appendEventInternal(snapshot.copy(events=snapshot.events.map { if(it.id==event.id)oldEvent else it },observations=snapshot.observations.map { if(it.id==current.id)superseded else it }),revised.copy(revisionOf=event.id,observations=revised.observations.map { it.copy(revisionOf=current.id) }),true)
    }
    fun latestObservation(snapshot: NativePatientVaultSnapshot,patientId: String,metricId: String,unit: String?=null,asOf: String?=null): NativePatientObservation? = snapshot.observations.filter { it.patientId==patientId&&it.metricId==metricId&&(unit.isNullOrEmpty()||it.unit==unit)&&(asOf==null||(parseNativePatientDate(it.observedAt)?.let { observed ->parseNativePatientDate(asOf)?.let { observed<=it } }==true))&&it.supersededBy==null }.sortedWith { a,b->compareNativePatientText(b.observedAt,a.observedAt) }.firstOrNull()
    fun observationSeriesKey(observation: NativePatientObservation): String {
        val source=observation.source;val method=when(source){is NativePatientObservationSource.ToolResult->"${source.toolId}@${source.toolVersion}";is NativePatientObservationSource.Manual->"${source.label}@${source.metricVersion}";is NativePatientObservationSource.Laboratory->"laboratory:${source.label}"}
        return "${observation.metricId}|${observation.unit}|$method|${observation.method ?: ""}"
    }
    fun buildDynamics(snapshot: NativePatientVaultSnapshot,patientId: String): List<NativeDynamicsSeries> = snapshot.observations.filter { it.patientId==patientId&&it.supersededBy==null }.groupBy(::observationSeriesKey).map { (key,observations) ->
        val first=observations.first();val method=when(val source=first.source){is NativePatientObservationSource.ToolResult->"${source.toolId} · ${source.toolVersion}";is NativePatientObservationSource.Manual->source.label;is NativePatientObservationSource.Laboratory->"Лаборатория · ${source.label}"}
        NativeDynamicsSeries(key,first.metricId,first.unit,method+(first.method?.takeIf(String::isNotEmpty)?.let { " · $it" } ?: ""),observations.sortedWith { a,b->compareNativePatientText(a.observedAt,b.observedAt) })
    }.sortedWith { a,b->compareNativePatientText(a.metricId,b.metricId).takeIf { it!=0 } ?: compareNativePatientText(a.unit,b.unit).takeIf { it!=0 } ?: compareNativePatientText(a.method,b.method) }
    fun buildDynamicsGroups(snapshot: NativePatientVaultSnapshot,patientId: String): List<NativeDynamicsChartGroup> = buildDynamics(snapshot,patientId).groupBy { (if(it.metricId in listOf("blood-pressure-systolic","blood-pressure-diastolic"))"blood-pressure" else it.metricId)+"|"+it.unit }.map { (key,series)->NativeDynamicsChartGroup(key,if(key.startsWith("blood-pressure|"))"blood-pressure" else series.first().metricId,series.first().unit,series) }.sortedWith { a,b->compareNativePatientText(a.metricId,b.metricId).takeIf { it!=0 } ?: compareNativePatientText(a.key,b.key) }
    fun patientContextSnapshot(profile: NativePatientProfile,snapshot: NativePatientVaultSnapshot,eventDate: String): NativePatientValues {
        val result=(profile.context ?: emptyMap()).toMutableMap()
        profile.birthDate?.takeIf(String::isNotEmpty)?.let { val age=calculateAgeOnDate(it,eventDate);result["birthDate"]=NativeToolInput.Text(it);result["ageYears"]=NativeToolInput.Number(ageInYearsOnDate(it,eventDate));result["ageMonths"]=NativeToolInput.Number((age.years*12+age.months).toDouble()) }
        profile.biologicalSex?.takeIf(String::isNotEmpty)?.let { result["biologicalSex"]=NativeToolInput.Text(it) }
        latestObservation(snapshot,profile.id,"body-mass","кг",eventDate)?.let { result["weightKg"]=NativeToolInput.Number(it.value) }
        latestObservation(snapshot,profile.id,"body-height","см",eventDate)?.let { result["heightCm"]=NativeToolInput.Number(it.value) }
        return result
    }
    fun patientBindingValue(binding: NativeToolPatientBinding,profile: NativePatientProfile,snapshot: NativePatientVaultSnapshot,eventDate: String): NativeToolInput? {
        if(binding.kind in listOf("birthDate","dateOfBirth"))return profile.birthDate?.let { NativeToolInput.Text(it.take(10)) }
        if(binding.kind=="biologicalSex")return profile.biologicalSex?.let(NativeToolInput::Text)
        if(binding.kind=="ageAtEvent")return profile.birthDate?.takeIf(String::isNotEmpty)?.let { NativeToolInput.Number(ageInYearsOnDate(it,eventDate)) }
        val metric=binding.metricId?.takeIf(String::isNotEmpty) ?: return null
        val observation=latestObservation(snapshot,profile.id,metric,binding.unit,eventDate) ?: return null
        binding.maxAgeDays?.let { max -> val age=(parseNativePatientDate(eventDate) ?: Double.NaN)-(parseNativePatientDate(observation.observedAt) ?: Double.NaN);if(!age.isFinite()||age<0||age>max*86400000.0)return null }
        return NativeToolInput.Number(observation.value)
    }
    fun normalizePatientVaultSnapshot(value: JsonElement): NativePatientVaultSnapshot = normalizeNativePatientSnapshot(value)
}

internal fun checkObservationKind(event: NativePatientEvent,o: NativePatientObservation) {
    if(event.kind=="tool-result")require(o.source is NativePatientObservationSource.ToolResult&&o.source.toolId==event.provenance?.toolId&&o.source.toolVersion==event.provenance?.toolVersion) { "Происхождение наблюдения не совпадает с результатом инструмента." }
    if(event.kind=="manual-measurement")require(o.source is NativePatientObservationSource.Manual) { "Ручное событие содержит не ручное наблюдение." }
    if(event.kind=="laboratory-result")require(o.source is NativePatientObservationSource.Laboratory) { "Лабораторное событие содержит не лабораторное наблюдение." }
}
private fun metricDefinitionsForEvents(snapshot: NativePatientVaultSnapshot,events: List<NativePatientEvent>): List<NativePatientMetricDefinition> {
    val keys=events.flatMap { it.observations }.map { "${it.metricId}|${(it.source as? NativePatientObservationSource.Manual)?.label ?: ""}|${it.unit}" }.toSet()
    return snapshot.metricDefinitions.filter { "${it.metricId}|${it.label}|${it.unit}" in keys }
}
@kotlinx.serialization.Serializable data class NativePatientRegistryMetric(val metricId: String,val label: String,val unit: String,val metricVersion: String="1",val kind: String="registry")
val NATIVE_PATIENT_METRIC_REGISTRY=listOf(NativePatientRegistryMetric("body-mass","Масса тела","кг"),NativePatientRegistryMetric("body-height","Рост","см"),NativePatientRegistryMetric("blood-pressure-systolic","Давление: систолическое","мм рт. ст."),NativePatientRegistryMetric("blood-pressure-diastolic","Давление: диастолическое","мм рт. ст."),NativePatientRegistryMetric("pulse","Пульс","уд/мин"),NativePatientRegistryMetric("temperature","Температура","°C"),NativePatientRegistryMetric("oxygen-saturation","SpO₂","%"))
