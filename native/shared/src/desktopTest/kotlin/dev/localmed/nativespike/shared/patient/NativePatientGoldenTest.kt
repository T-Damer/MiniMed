package dev.localmed.nativespike.shared.patient

import dev.localmed.nativespike.shared.golden.readTestResource
import dev.localmed.nativespike.shared.tools.NativeToolInput
import dev.localmed.nativespike.shared.tools.NativeToolPatientBinding
import kotlinx.serialization.json.*
import java.io.File
import java.security.MessageDigest
import java.util.Locale
import java.util.TimeZone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class NativePatientGoldenTest {
    private val json=Json { explicitNulls=false;ignoreUnknownKeys=true;allowSpecialFloatingPointValues=true }
    /** Fixture tagged numbers are input transport only; the production boundary rejects them. */
    private fun decodeTags(value: JsonElement): JsonElement = when(value) {
        is JsonArray->JsonArray(value.map { if(it is JsonObject&&it["\$undefined"]!=null)JsonNull else decodeTags(it) })
        is JsonObject->if(value["\$number"]!=null)JsonPrimitive(when(value.getValue("\$number").jsonPrimitive.content){"NaN"->Double.NaN;"Infinity"->Double.POSITIVE_INFINITY;else->Double.NEGATIVE_INFINITY})else JsonObject(value.filterValues { !(it is JsonObject&&it["\$undefined"]!=null) }.mapValues { decodeTags(it.value) })
        else->value
    }
    private fun run(domain: NativePatientDomain,op: String,args: JsonArray): JsonElement {
        fun string(index: Int)=args[index].jsonPrimitive.content
        fun nullableString(index: Int)=args.getOrNull(index)?.takeIf { it!=JsonNull }?.jsonPrimitive?.content
        fun snapshot(index: Int=0)=json.decodeFromJsonElement<NativePatientVaultSnapshot>(args[index])
        return when(op) {
            "emptyPatientVaultSnapshot"->json.encodeToJsonElement(domain.emptyPatientVaultSnapshot())
            "createPatientProfile"->json.encodeToJsonElement(domain.createPatientProfile(decodeNativeCreatePatientProfileInput(args[0])))
            "createClinicalEpisode"->json.encodeToJsonElement(domain.createClinicalEpisode(json.decodeFromJsonElement(args[0])))
            "closeClinicalEpisode"->json.encodeToJsonElement(domain.closeClinicalEpisode(snapshot(),string(1),string(2)))
            "calculateAgeOnDate"->json.encodeToJsonElement(domain.calculateAgeOnDate(string(0),string(1)))
            "ageInYearsOnDate"->JsonPrimitive(domain.ageInYearsOnDate(string(0),string(1)))
            "createManualMeasurementEvent"->json.encodeToJsonElement(domain.createManualMeasurementEvent(json.decodeFromJsonElement(args[0])))
            "createLaboratoryEvent"->json.encodeToJsonElement(domain.createLaboratoryEvent(json.decodeFromJsonElement(args[0])))
            "createMedicationEvent"->json.encodeToJsonElement(domain.createMedicationEvent(json.decodeFromJsonElement(args[0])))
            "appendEvent"->json.encodeToJsonElement(domain.appendEvent(snapshot(),json.decodeFromJsonElement(args[1])))
            "appendEpisode"->json.encodeToJsonElement(domain.appendEpisode(snapshot(),json.decodeFromJsonElement(args[1])))
            "removePatientFromSnapshot"->json.encodeToJsonElement(domain.removePatientFromSnapshot(snapshot(),string(1)))
            "selectPatientFromSnapshot"->json.encodeToJsonElement(domain.selectPatientFromSnapshot(snapshot(),string(1)))
            "createToolResultEvent"->json.encodeToJsonElement(domain.createToolResultEvent(json.decodeFromJsonElement(args[0])))
            "appendToolResultIdempotently"->json.encodeToJsonElement(domain.appendToolResultIdempotently(snapshot(),json.decodeFromJsonElement(args[1])))
            "reviseManualObservation"->json.encodeToJsonElement(domain.reviseManualObservation(snapshot(),string(1),json.decodeFromJsonElement(args[2])))
            "latestObservation"->domain.latestObservation(snapshot(),string(1),string(2),nullableString(3),nullableString(4))?.let { json.encodeToJsonElement(it) } ?: JsonNull
            "observationSeriesKey"->JsonPrimitive(domain.observationSeriesKey(json.decodeFromJsonElement(args[0])))
            "buildDynamics"->json.encodeToJsonElement(domain.buildDynamics(snapshot(),string(1)))
            "buildDynamicsGroups"->json.encodeToJsonElement(domain.buildDynamicsGroups(snapshot(),string(1)))
            "patientContextSnapshot"->encodeValues(domain.patientContextSnapshot(json.decodeFromJsonElement(args[0]),snapshot(1),string(2)))
            "patientBindingValue"->domain.patientBindingValue(json.decodeFromJsonElement<NativeToolPatientBinding>(args[0]),json.decodeFromJsonElement(args[1]),snapshot(2),string(3))?.let(::encodeValue) ?: JsonNull
            "normalizePatientVaultSnapshot"->json.encodeToJsonElement(domain.normalizePatientVaultSnapshot(args[0]))
            else->error("Unknown patient operation")
        }
    }
    private fun encodeValue(value: NativeToolInput): JsonElement=when(value){is NativeToolInput.Text->JsonPrimitive(value.value);is NativeToolInput.Number->JsonPrimitive(value.value)}
    private fun encodeValues(value: NativePatientValues)=JsonObject(value.mapValues { encodeValue(it.value) })
    @Test fun oracleIsBoundToActualSourceFiles() {
        val root=File(System.getProperty("NATIVE_SLICE_ROOT"))
        val fixture=json.parseToJsonElement(readTestResource("native-patient-golden.json")).jsonObject
        fixture.getValue("sources").jsonArray.forEach { raw ->
            val row=raw.jsonObject;val file=File(root,row.getValue("path").jsonPrimitive.content).canonicalFile
            require(file.toPath().startsWith(root.canonicalFile.toPath()))
            val hash=MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString("") { (it.toInt() and 255).toString(16).padStart(2,'0') }
            assertEquals(row.getValue("sha256").jsonPrimitive.content,hash)
        }
    }
    @Test fun allAuthoritativeSchema2OperationsAndErrors() {
        val locale=Locale.getDefault();val zone=TimeZone.getDefault()
        try {
            Locale.setDefault(Locale.US);TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
            val fixture=json.parseToJsonElement(readTestResource("native-patient-golden.json")).jsonObject
            assertEquals("UTC",fixture.getValue("dateContext").jsonPrimitive.content)
            val cases=fixture.getValue("cases").jsonArray;val failures=mutableListOf<String>()
            for((index,raw) in cases.withIndex()) {
                val row=raw.jsonObject;val uuids=row.getValue("uuids").jsonArray.map { it.jsonPrimitive.content }.iterator();val clocks=row.getValue("clockValues").jsonArray.map { it.jsonPrimitive.content }.iterator()
                val domain=NativePatientDomain(NativePatientContext({clocks.next()},{uuids.next()}))
                var actual: JsonElement=JsonNull;var error: String?=null
                try { actual=run(domain,row.getValue("operation").jsonPrimitive.content,decodeTags(row.getValue("args")).jsonArray) } catch(cause: IllegalArgumentException) { error=cause.message }
                val expectedError=row.getValue("error").takeIf { it!=JsonNull }?.jsonPrimitive?.content
                val expected=row.getValue("result").takeUnless { it is JsonObject&&it["\$undefined"]!=null } ?: JsonNull
                if(expectedError!=error || (error==null&&!equivalentNumbers(expected,actual)) || uuids.hasNext()||clocks.hasNext())failures+="$index:${row.getValue("operation").jsonPrimitive.content}:error=${error ?: "none"}:unusedUuid=${uuids.hasNext()}:unusedClock=${clocks.hasNext()}"
            }
            assertTrue(failures.isEmpty(),failures.joinToString("\n"))
            assertEquals(23,fixture.getValue("operations").jsonArray.size)
            val registryJson=Json { encodeDefaults=true }.encodeToJsonElement(NATIVE_PATIENT_METRIC_REGISTRY)
            assertEquals(fixture.getValue("metricRegistry"),registryJson)
        } finally { Locale.setDefault(locale);TimeZone.setDefault(zone) }
    }
    private fun equivalentNumbers(a: JsonElement,b: JsonElement): Boolean = when {
        a is JsonObject&&b is JsonObject->a.keys==b.keys&&a.all { (key,value)->equivalentNumbers(value,b.getValue(key)) }
        a is JsonArray&&b is JsonArray->a.size==b.size&&a.indices.all { equivalentNumbers(a[it],b[it]) }
        a is JsonPrimitive&&b is JsonPrimitive&&!a.isString&&!b.isString&&a.doubleOrNull!=null&&b.doubleOrNull!=null->a.double==b.double
        else->a==b
    }
    @Test fun dateParserProbesAndPlatformCollation() {
        val locale=Locale.getDefault();val zone=TimeZone.getDefault()
        try {
            Locale.setDefault(Locale.US);TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
            val fixture=json.parseToJsonElement(readTestResource("native-patient-golden.json")).jsonObject
            fixture.getValue("dateProbes").jsonArray.forEach { raw ->val row=raw.jsonObject;val value=row.getValue("epochMilliseconds");assertEquals(if(value is JsonObject)null else value.jsonPrimitive.double,parseNativePatientDate(row.getValue("value").jsonPrimitive.content),"date parser probe") }
            val probes=fixture.getValue("collationProbes").jsonObject
            val actual=probes.getValue("values").jsonArray.map { it.jsonPrimitive.content }.sortedWith(::compareNativePatientText)
            assertEquals(probes.getValue("sorted").jsonArray.map { it.jsonPrimitive.content },actual)
        } finally { Locale.setDefault(locale);TimeZone.setDefault(zone) }
    }
    @Test fun unsupportedLegacyDatesDoNotRewriteRawSnapshot() {
        val raw=JsonObject(mapOf("schemaVersion" to JsonPrimitive(2),"profiles" to JsonArray(listOf(JsonObject(mapOf("id" to JsonPrimitive("synthetic"),"displayName" to JsonPrimitive("Синтетический профиль"),"createdAt" to JsonPrimitive("2 Jan 2025"),"updatedAt" to JsonPrimitive("2 Jan 2025"))))),"episodes" to JsonArray(emptyList()),"events" to JsonArray(emptyList()),"observations" to JsonArray(emptyList())))
        val before=raw.toString();assertFailsWith<UnsupportedPatientDateFormat> { normalizeNativePatientSnapshot(raw) };assertEquals(before,raw.toString())
    }
}
