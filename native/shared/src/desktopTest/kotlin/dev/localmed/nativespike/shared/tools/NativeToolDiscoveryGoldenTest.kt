package dev.localmed.nativespike.shared.tools

import dev.localmed.nativespike.shared.model.QueryAnalysis
import java.io.File
import java.security.MessageDigest
import kotlinx.serialization.json.*
import kotlinx.serialization.decodeFromString
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class NativeToolDiscoveryGoldenTest {
    private val json = Json { ignoreUnknownKeys = false }
    private val root = File(System.getProperty("TEST_RESOURCE_DIR")).canonicalFile.parentFile.parentFile.parentFile.parentFile.parentFile
    private val fixture by lazy { json.parseToJsonElement(File(System.getProperty("TEST_RESOURCE_DIR"),"native-tool-discovery-golden.json").readText()).jsonObject }
    private fun core() = NativeToolCore(File(root,"native/shared/src/commonMain/composeResources/files/native-tool-data.json").readText(),NativeToolContext("2026-09-30"))
    @Test fun all407BrowserCatalogQueriesPreserveOrderedBankMatches() {
        val core = core()
        for(rowElement in fixture.getValue("catalog").jsonArray) {
            val row = rowElement.jsonObject; val query = row.getValue("query").jsonPrimitive.content
            for(kind in NativeToolKind.entries) assertEquals(row.getValue(kind.wire+"Ids").jsonArray.map { it.jsonPrimitive.content },core.searchTools(query,kind).map { it.tool.id },"$kind catalog query")
        }
        assertEquals(69,core.searchTools("").size)
    }
    private fun canonical(value: JsonElement): JsonElement = when(value) {
        is JsonObject -> JsonObject(value.mapValues { canonical(it.value) })
        is JsonArray -> JsonArray(value.map(::canonical))
        is JsonPrimitive -> if(!value.isString && value.doubleOrNull != null) JsonPrimitive(value.double) else value
    }
    private fun scalar(value: NativeToolInput): JsonPrimitive = when(value) { is NativeToolInput.Text -> JsonPrimitive(value.value); is NativeToolInput.Number -> JsonPrimitive(value.value) }
    private fun inputs(value: Map<String,NativeToolInput>) = JsonObject(value.mapValues { scalar(it.value) })
    private fun options(value: List<NativeCalculatorInputOption>) = JsonArray(value.map { buildJsonObject { put("value",scalar(it.value));put("label",it.label) } })
    private fun opportunity(value: NativeCalculatorOpportunity?): JsonElement = value?.let { v -> buildJsonObject {
        put("kind",v.kind);put("requiresConfirmation",v.requiresConfirmation);v.selectedCalculatorId?.let { put("selectedCalculatorId",it) }
        put("draftInputs",inputs(v.draftInputs));put("formOptions",options(v.formOptions));put("routeOptions",options(v.routeOptions));put("indicationOptions",options(v.indicationOptions))
        put("candidates",JsonArray(v.candidates.map { c -> buildJsonObject {
            put("calculatorId",c.calculatorId);put("label",c.label);c.canonicalTerm?.let { put("canonicalTerm",it) };c.matchedText?.let { put("matchedText",it) };c.matchType?.let { put("matchType",it) }
            put("draftInputs",inputs(c.draftInputs));put("formOptions",options(c.formOptions));put("routeOptions",options(c.routeOptions));put("indicationOptions",options(c.indicationOptions))
        } }))
    } } ?: JsonNull
    @Test fun bankNoBindingsAnd25ActualBrowserBoundaryCasesPreserveConfirmationAndDrafts() {
        val core = core()
        for(element in fixture.getValue("opportunities").jsonArray) {
            val row = element.jsonObject;val analysis = json.decodeFromJsonElement<QueryAnalysis>(row.getValue("analysis"))
            assertEquals(canonical(row.getValue("result")),canonical(opportunity(core.calculatorOpportunity(analysis))),row.getValue("caseName").jsonPrimitive.content)
        }
        for(element in fixture.getValue("boundaryOpportunities").jsonArray) {
            val row = element.jsonObject;val analysis = json.decodeFromJsonElement<QueryAnalysis>(row.getValue("analysis"))
            val schemas = row.getValue("schemas").jsonArray.map { json.decodeFromJsonElement<NativeCalculatorDefinition>(it) }
            assertEquals(canonical(row.getValue("result")),canonical(opportunity(resolveNativeCalculatorOpportunity(analysis,schemas))),row.getValue("caseName").jsonPrimitive.content)
        }
    }
    @Test fun oracleBindsActualBrowserSourceAndEveryModuleAndRejectsMalformedCatalogOrder() {
        for(element in fixture.getValue("sources").jsonArray) {
            val row = element.jsonObject;val file = File(root,row.getValue("path").jsonPrimitive.content).canonicalFile
            require(file.toPath().startsWith(root.canonicalFile.toPath()))
            val sha = MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString("") { "%02x".format(it) }
            assertEquals(row.getValue("sha256").jsonPrimitive.content,sha,"Discovery source changed; recapture actual browser oracle")
        }
        val catalogSource = core().catalogSource
        assertEquals(fixture.getValue("sources").jsonArray.first { it.jsonObject.getValue("path").jsonPrimitive.content == catalogSource.path }.jsonObject.getValue("sha256").jsonPrimitive.content,catalogSource.sha256)
        val bank = json.parseToJsonElement(File(root,"native/shared/src/commonMain/composeResources/files/native-tool-data.json").readText()).jsonObject
        for(order in listOf(JsonArray(emptyList()),JsonArray(bank.getValue("catalogOrder").jsonArray.toList()+bank.getValue("catalogOrder").jsonArray.first()))) {
            assertFailsWith<IllegalArgumentException> { NativeToolCore(JsonObject(bank+mapOf("catalogOrder" to order)).toString(),NativeToolContext("2026-09-30")) }
        }
    }
}
