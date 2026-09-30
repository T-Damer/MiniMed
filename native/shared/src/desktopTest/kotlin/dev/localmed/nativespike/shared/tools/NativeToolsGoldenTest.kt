package dev.localmed.nativespike.shared.tools

import java.io.File
import java.security.MessageDigest
import dev.localmed.nativespike.shared.text.jsNumberToFixed
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertFailsWith
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.*

@OptIn(ExperimentalSerializationApi::class)
class NativeToolsGoldenTest {
    private val json = Json { explicitNulls = false; encodeDefaults = true }
    private val root = File(System.getProperty("NATIVE_SLICE_ROOT") ?: "..")
    private val bankFile = File(root, "native/shared/src/commonMain/composeResources/files/native-tool-data.json")
    private fun sourceHash(path: String): String {
        val file = File(root, path).canonicalFile
        require(file.toPath().startsWith(root.canonicalFile.toPath())) { "Source path escapes repository" }
        return MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString("") { (it.toInt() and 255).toString(16).padStart(2, '0') }
    }
    private fun fixture() = json.parseToJsonElement(File(System.getProperty("TEST_RESOURCE_DIR"), "native-tools-golden.json").readText()).jsonObject
    private fun core(fixture: JsonObject) = NativeToolCore(bankFile.readText(), NativeToolContext(fixture.getValue("today").jsonPrimitive.content))
    private fun chart(chart: NativeToolChart): JsonObject = buildJsonObject {
        put("type", chart.type); put("title", chart.title); put("labels", JsonArray(chart.labels.map(::JsonPrimitive)))
        put("datasets", JsonArray(chart.datasets.map { dataset -> buildJsonObject {
            put("label", dataset.label); put("data", JsonArray(dataset.data.map { point -> when(point) {
                is NativeToolChartPoint.Number -> JsonPrimitive(point.value)
                is NativeToolChartPoint.XY -> buildJsonObject { put("x", point.x); put("y", point.y) }
            } })); dataset.render?.let { put("render", it) }; dataset.tone?.let { put("tone", it) }
        } })); chart.caption?.let { put("caption", it) }; chart.heightPx?.let { put("heightPx", it) }
        chart.xAxis?.let { put("xAxis", json.encodeToJsonElement(it)) }; chart.yAxis?.let { put("yAxis", json.encodeToJsonElement(it)) }; chart.annotations?.let { put("annotations", json.encodeToJsonElement(it)) }
    }
    private fun calculator(result: NativeCalculatorResult): JsonObject = when(result) {
        is NativeCalculatorResult.Failure -> buildJsonObject { put("ok", false); put("error", result.error) }
        is NativeCalculatorResult.Success -> buildJsonObject {
            put("ok", true); put("calculatorId", result.calculatorId); put("formula", result.formula)
            put("outputs", JsonArray(result.outputs.map { output -> buildJsonObject {
                put("id", output.id); put("label", output.label)
                when(output) {
                    is NativeCalculatorOutput.Number -> { put("kind", "number"); put("value", output.value); put("unit", output.unit); put("displayPrecision", output.displayPrecision) }
                    is NativeCalculatorOutput.Text -> { put("kind", "text"); put("text", output.text) }
                    is NativeCalculatorOutput.Visual -> { put("kind", "visual"); put("chart", chart(output.chart)) }
                }
            } })); put("trace", json.encodeToJsonElement(result.trace)); put("warnings", json.encodeToJsonElement(result.warnings)); put("evaluation", json.encodeToJsonElement(result.evaluation))
        }
    }
    private fun assessment(result: NativeAssessmentResult): JsonObject = when(result) {
        is NativeAssessmentResult.Failure -> buildJsonObject { put("ok", false); put("error", result.error) }
        is NativeAssessmentResult.Success -> buildJsonObject { put("ok", true); put("value", buildJsonObject {
            val v = result.value; put("assessmentId", v.assessmentId); put("completedAt", v.completedAt)
            put("scores", json.encodeToJsonElement(v.scores)); put("primaryScaleIds", JsonArray(v.primaryScaleIds.map(::JsonPrimitive)))
            put("headline", v.headline); put("summary", v.summary); put("disclaimer", v.disclaimer); put("evaluation", json.encodeToJsonElement(v.evaluation)); v.visuals?.let { put("visuals", JsonArray(it.map(::chart))) }
        }) }
    }
    private fun ulps(expected: Double, actual: Double): Long = if (!expected.isFinite() || !actual.isFinite() || (expected < 0) != (actual < 0)) Long.MAX_VALUE else kotlin.math.abs(expected.toBits() - actual.toBits())
    private fun approvedNumericInterop(d: Difference, maximum: Long?): Boolean = maximum != null && d.expected != null && d.actual != null && ulps(d.expected, d.actual) <= maximum
    private fun displays(expected: JsonObject, actual: JsonObject): List<Difference> {
        if (expected["ok"]?.jsonPrimitive?.boolean != true || actual["ok"]?.jsonPrimitive?.boolean != true) return emptyList()
        val expectedRows = expected["outputs"]?.jsonArray ?: return emptyList()
        val actualRows = actual["outputs"]?.jsonArray ?: return emptyList()
        if (expectedRows.size != actualRows.size) return emptyList()
        return expectedRows.indices.mapNotNull { index ->
            val e = expectedRows[index].jsonObject; val a = actualRows[index].jsonObject
            if (e["kind"]?.jsonPrimitive?.content != "number" || a["kind"]?.jsonPrimitive?.content != "number") null
            else if (jsNumberToFixed(e.getValue("value").jsonPrimitive.double, e.getValue("displayPrecision").jsonPrimitive.int) == jsNumberToFixed(a.getValue("value").jsonPrimitive.double, a.getValue("displayPrecision").jsonPrimitive.int)) null
            else Difference("result.outputs[$index].display")
        }
    }
    private data class Difference(val path: String, val expected: Double? = null, val actual: Double? = null)
    private fun differences(expected: JsonElement, actual: JsonElement, path: String): List<Difference> = when {
        expected is JsonObject && actual is JsonObject -> (expected.keys + actual.keys).flatMap { key -> if(expected[key] == null || actual[key] == null) listOf(Difference("$path.$key")) else differences(expected.getValue(key), actual.getValue(key), "$path.$key") }
        expected is JsonArray && actual is JsonArray -> if(expected.size != actual.size) listOf(Difference("$path.size")) else expected.indices.flatMap { differences(expected[it], actual[it], "$path[$it]") }
        expected is JsonPrimitive && actual is JsonPrimitive && !expected.isString && !actual.isString && expected.doubleOrNull != null && actual.doubleOrNull != null -> if(expected.doubleOrNull!! == actual.doubleOrNull!!) emptyList() else listOf(Difference(path, expected.doubleOrNull, actual.doubleOrNull))
        expected == actual -> emptyList()
        else -> listOf(Difference(path))
    }
    @Test fun all3014ActualSchemaEngineCasesMatchEveryTypedField() {
        val fixture = fixture(); assertEquals("UTC", fixture.getValue("timezone").jsonPrimitive.content)
        val core = core(fixture); assertEquals(69, core.tools().size); assertEquals(8, core.moduleSources.size)
        val interop = json.parseToJsonElement(File(System.getProperty("TEST_RESOURCE_DIR"), "native-tools-numeric-interop.json").readText()).jsonObject
        val prepared = json.parseToJsonElement(bankFile.readText()).jsonObject
        assertEquals(fixture.getValue("records"), prepared.getValue("records"), "Source tool authoring changed: recapture oracle")
        val moduleHashes = JsonArray(core.moduleSources.map { buildJsonObject { put("path", it.path); put("sha256", it.sha256) } })
        assertEquals(fixture.getValue("sources"), moduleHashes, "Source module hashes changed: recapture oracle")
        val modelHashes = JsonArray(core.modelSources.map { buildJsonObject { put("path", it.path); put("sha256", it.sha256) } })
        assertEquals(interop.getValue("sourceModels"), modelHashes, "Static model hashes changed: recapture oracle")
        for(source in core.moduleSources) assertEquals(source.sha256, sourceHash(source.path), "Stale prepared tool source")
        for(source in core.modelSources) assertEquals(source.sha256, sourceHash(source.path), "Stale prepared model source")
        assertEquals(interop.getValue("oracleSha256").jsonPrimitive.content, sourceHash("native/shared/src/commonTest/resources/native-tools-golden.json"), "Oracle changed: review numeric interoperability inventory")
        val allowedRows = interop.getValue("leaves").jsonArray
        assertEquals(173, allowedRows.size)
        val allowed = allowedRows.map { it.jsonObject }.associate { row ->
            Triple(row.getValue("id").jsonPrimitive.content, row.getValue("case").jsonPrimitive.content, row.getValue("path").jsonPrimitive.content) to row.getValue("maxUlp").jsonPrimitive.long
        }
        assertEquals(173, allowed.size); assertTrue(allowed.values.all { it in 1..8 })
        val rows = mutableListOf<JsonObject>(); var rejected = 0; var calculatorSuccess = 0; var assessmentSuccess = 0
        fun record(kind: String, row: JsonObject, actual: JsonObject) {
            val id = row.getValue("toolId").jsonPrimitive.content; val name = row.getValue("caseName").jsonPrimitive.content
            val diffs = differences(row.getValue("result"), actual, "result") + if(kind == "calculator") displays(row.getValue("result").jsonObject, actual) else emptyList()
            for(d in diffs) {
                val maximum = allowed[Triple(id, name, d.path)]
                val distance = if (d.expected != null && d.actual != null) ulps(d.expected, d.actual) else Long.MAX_VALUE
                val accepted = approvedNumericInterop(d, maximum)
                if (!accepted) rejected++
                rows += buildJsonObject { put("approvedInterop", accepted); maximum?.let { put("allowedMaxUlp", it) }; if(d.expected != null) put("ulpDifference", distance); put("kind", kind); put("id", id); put("case", name); put("path", d.path); d.expected?.let { put("expected", it) }; d.actual?.let { put("actual", it); put("absoluteDifference", kotlin.math.abs(it - d.expected!!)) } }
            }
        }
        val calculatorRows = fixture.getValue("calculatorCases").jsonArray; assertEquals(1471, calculatorRows.size)
        for(element in calculatorRows) { val row = element.jsonObject; val inputs = row.getValue("inputs").jsonObject.mapValues { (_, value) -> if(value.jsonPrimitive.isString) NativeToolInput.Text(value.jsonPrimitive.content) else NativeToolInput.Number(value.jsonPrimitive.double) }.toMutableMap()
            row["nonFiniteInputs"]?.jsonArray?.forEach { inputs[it.jsonPrimitive.content] = NativeToolInput.Number(Double.NaN) }
            val result = core.evaluateCalculator(row.getValue("toolId").jsonPrimitive.content, inputs, row["options"]?.jsonObject?.get("maxStep")?.jsonPrimitive?.int)
            if(result is NativeCalculatorResult.Success) calculatorSuccess++; record("calculator", row, calculator(result))
        }
        val assessmentRows = fixture.getValue("assessmentCases").jsonArray; assertEquals(1543, assessmentRows.size)
        for(element in assessmentRows) { val row = element.jsonObject; val answers = row.getValue("answers").jsonObject.mapValues { it.value.jsonPrimitive.double }; val expectedAt = row.getValue("result").jsonObject["value"]?.jsonObject?.get("completedAt")?.jsonPrimitive?.content ?: fixture.getValue("generatedAt").jsonPrimitive.content
            val result = core.scoreAssessment(row.getValue("toolId").jsonPrimitive.content, answers, expectedAt)
            if(result is NativeAssessmentResult.Success) assessmentSuccess++; record("assessment", row, assessment(result))
        }
        val report = buildJsonObject { put("calculatorCases", calculatorRows.size); put("assessmentCases", assessmentRows.size); put("calculatorSuccess", calculatorSuccess); put("assessmentSuccess", assessmentSuccess); put("comparison", "exact default; frozen173 measured numeric leaves bounded by per-case/path ULP; all categorical/text/display/assessment fields exact"); put("unapprovedDifferences", rejected); put("differences", JsonArray(rows)) }
        File(root, "playwright/native-tools-oracle-comparison.json").writeText(report.toString() + "\n")
        assertEquals(695, calculatorSuccess); assertEquals(1056, assessmentSuccess)
        assertEquals(0, rejected, "Unapproved tool parity differences=$rejected; approved numeric leaves=${rows.size - rejected}; paths=${rows.take(10).map { it.getValue("path").jsonPrimitive.content }}; see playwright/native-tools-oracle-comparison.json")
    }
    @Test fun actualPublicCorePreservesSchemaMetadataAndDefaultsAndRejectsUnknownIdentity() {
        val core = core(fixture()); val records = core.tools(); assertEquals(records.size, records.map { it.id }.distinct().size)
        records.forEach { record -> assertTrue(record.version.isNotBlank() && record.sources.isNotEmpty()); when(val definition = record.definition) { is NativeToolDefinition.Calculator -> assertEquals(record.id, definition.value.id); is NativeToolDefinition.Assessment -> { assertEquals(record.id, definition.value.id); assertTrue(definition.value.license.notice.isNotBlank()) } } }
        val calc = records.first { it.kind == "calculator" }; assertTrue(core.initialCalculatorValues(calc.id).isNotEmpty()); assertTrue(!core.calculatorInputsReady(calc.id, emptyMap()))
        assertFailsWith<IllegalArgumentException> { core.evaluateCalculator("missing", emptyMap()) }
        val raw = json.parseToJsonElement(bankFile.readText()).jsonObject
        val changed = JsonObject(raw + ("schemaVersion" to JsonPrimitive(99)))
        assertFailsWith<IllegalArgumentException> { NativeToolCore(changed.toString(), NativeToolContext("2026-09-30")) }
        assertFailsWith<IllegalArgumentException> { NativeToolCore(bankFile.readText(), NativeToolContext("2026-02-31")) }
    }
    @Test fun actualInterpreterUsesLazyBranchesAndPreservesTraceExponents() {
        val bank = NativeToolBank(bankFile.readText()); val expression = ToolExpression(bank, NativeToolContext("2026-09-30"))
        assertEquals(NativeToolInput.Number(2.0), expression.evaluate("cond(0, missing, 2)", emptyMap()))
        assertEquals(null, expression.evaluate("optional(present(missing), missing / 0)", emptyMap()))
        assertFailsWith<ToolExpressionError> { expression.evaluate("min(1)", emptyMap()) }
        assertFailsWith<ToolExpressionError> { expression.evaluate("eval(1)", emptyMap()) }
        assertFailsWith<ToolExpressionError> { expression.evaluate("x.y", emptyMap()) }
        val node = expression.parse("x")
        for((value, expected) in listOf(1.234567e-10 to "1.23457e-10", 1e-20 to "1e-20", 99999.96 to "100000", 1.234567e20 to "123456700000000000000")) assertEquals(expected, expression.render(node, mapOf("x" to NativeToolInput.Number(value))))
        assertEquals(NativeToolInput.Text("2024-03-02"), expression.evaluate("addDays(\"2024-02-31\", 0)", emptyMap()))
        assertEquals(NativeToolInput.Number(1.0), expression.evaluate("yearsBetween(\"2024-02-29\", \"2025-03-01\")", emptyMap()))
        assertEquals(NativeToolInput.Number(0.0), expression.evaluate("yearsBetween(\"2024-02-29\", \"2025-02-28\")", emptyMap()))
    }
    @Test fun actualBankRejectsBrokenIdentityBindingsAndExecutableSourceLinks() {
        val raw = json.parseToJsonElement(bankFile.readText()).jsonObject
        val originalRows = raw.getValue("records").jsonArray
        val index = originalRows.indexOfFirst { it.jsonObject.getValue("kind").jsonPrimitive.content == "calculator" }
        val record = originalRows[index].jsonObject
        fun reject(changed: JsonObject) {
            val rows = originalRows.toMutableList(); rows[index] = changed
            assertFailsWith<IllegalArgumentException> { NativeToolCore(JsonObject(raw + ("records" to JsonArray(rows))).toString(), NativeToolContext("2026-09-30")) }
        }
        fun definition(change: (JsonObject) -> JsonObject) = JsonObject(record + ("definition" to change(record.getValue("definition").jsonObject)))
        reject(JsonObject(record + ("id" to JsonPrimitive("different-payload-identity"))))
        reject(definition { v -> val rows = v.getValue("steps").jsonArray.toMutableList(); rows[0] = JsonObject(rows[0].jsonObject + ("displayPrecision" to JsonPrimitive(11))); JsonObject(v + ("steps" to JsonArray(rows))) })
        reject(definition { v -> val rows = v.getValue("sources").jsonArray.toMutableList(); rows[0] = JsonObject(rows[0].jsonObject + ("url" to JsonPrimitive("javascript:alert(1)"))); JsonObject(v + ("sources" to JsonArray(rows))) })
        reject(definition { v -> val rows = v.getValue("inputs").jsonArray.toMutableList(); rows[0] = JsonObject(rows[0].jsonObject + ("patientBinding" to buildJsonObject { put("kind", "latestObservation") })); JsonObject(v + ("inputs" to JsonArray(rows))) })
        reject(definition { v -> JsonObject(v + ("search" to buildJsonObject { put("kind", "invented-clinical-dose"); put("bindings", JsonObject(emptyMap())) })) })
        reject(definition { v -> JsonObject(v + ("search" to buildJsonObject { put("kind", "medication-dose"); put("bindings", JsonObject(emptyMap())) })) })
        reject(definition { v -> JsonObject(v + ("search" to buildJsonObject { put("kind", "infusion-volume"); put("bindings", buildJsonObject { put("weightKgInputId", "absent_input") }) })) })
    }
    @Test fun authoringAssessmentAssertionsRemainSourceMetadataRatherThanCalculatorRules() {
        val f = fixture(); val raw = json.parseToJsonElement(bankFile.readText()).jsonObject
        val rows = raw.getValue("records").jsonArray.toMutableList()
        val index = rows.indexOfFirst { it.jsonObject.getValue("kind").jsonPrimitive.content == "assessment" }
        val record = rows[index].jsonObject; val id = record.getValue("id").jsonPrimitive.content
        val assertions = buildJsonArray { add(buildJsonObject { put("when", "eval(1)"); put("error", "This authoring-only calculator rule must not execute.") }) }
        rows[index] = JsonObject(record + ("definition" to JsonObject(record.getValue("definition").jsonObject + ("assertions" to assertions))))
        val sourceCore = core(f); val changedCore = NativeToolCore(JsonObject(raw + ("records" to JsonArray(rows))).toString(), NativeToolContext("2026-09-30"))
        val case = f.getValue("assessmentCases").jsonArray.map { it.jsonObject }.first { it.getValue("toolId").jsonPrimitive.content == id && it.getValue("result").jsonObject.getValue("ok").jsonPrimitive.boolean }
        val answers = case.getValue("answers").jsonObject.mapValues { it.value.jsonPrimitive.double }
        val at = case.getValue("result").jsonObject.getValue("value").jsonObject.getValue("completedAt").jsonPrimitive.content
        assertEquals(sourceCore.scoreAssessment(id, answers, at), changedCore.scoreAssessment(id, answers, at))
        assertEquals("eval(1)", (changedCore.tool(id)!!.definition as NativeToolDefinition.Assessment).value.assertions!!.single().`when`)
    }

    @Test fun actualThresholdAdjacentBandsDomainsAndSourceDisplaysRemainExact() {
        val f = fixture(); val core = core(f)
        val thresholds = json.parseToJsonElement(File(System.getProperty("TEST_RESOURCE_DIR"), "native-tools-threshold-golden.json").readText()).jsonObject
        assertEquals("UTC", thresholds.getValue("timezone").jsonPrimitive.content); assertEquals(f.getValue("today"), thresholds.getValue("today"))
        val expressions = ToolExpression(NativeToolBank(bankFile.readText()), NativeToolContext(f.getValue("today").jsonPrimitive.content))
        val cases = thresholds.getValue("cases").jsonArray; assertEquals(19, cases.size)
        for(element in cases) {
            val row = element.jsonObject
            val inputs = row.getValue("inputs").jsonObject.mapValues { (_, v) -> if(v.jsonPrimitive.isString) NativeToolInput.Text(v.jsonPrimitive.content) else NativeToolInput.Number(v.jsonPrimitive.double) }
            val result = core.evaluateCalculator(row.getValue("toolId").jsonPrimitive.content, inputs)
            val actual = calculator(result)
            val visible = if(result is NativeCalculatorResult.Success) JsonObject(actual + mapOf(
                "outputs" to JsonArray(actual.getValue("outputs").jsonArray.mapNotNull { output -> val o = output.jsonObject; when(o.getValue("kind").jsonPrimitive.content) {
                    "visual" -> null
                    "number" -> JsonObject(o.filterKeys { it != "value" } + ("display" to JsonPrimitive(jsNumberToFixed(o.getValue("value").jsonPrimitive.double, o.getValue("displayPrecision").jsonPrimitive.int))))
                    else -> o
                } }),
                "trace" to JsonArray(actual.getValue("trace").jsonArray.map { JsonObject(it.jsonObject.filterKeys { key -> key != "value" }) })
            )) else actual
            assertEquals(row.getValue("visible"), visible, row.getValue("caseName").jsonPrimitive.content)
            row["whoBand"]?.let { expected ->
                val z = (result as NativeCalculatorResult.Success).outputs.filterIsInstance<NativeCalculatorOutput.Number>().first { it.id == "who0_muac_z" }.value
                assertEquals(NativeToolInput.Text(expected.jsonPrimitive.content), expressions.evaluate("whoBand(\"muac\", z)", mapOf("z" to NativeToolInput.Number(z))))
            }
        }
    }
    @Test fun actualLanguagePredicatesStayLazyAndDateTimeClipCannotOverflowCalendarLoop() {
        val expressions = ToolExpression(NativeToolBank(bankFile.readText()), NativeToolContext("2026-09-30"))
        assertEquals(NativeToolInput.Number(2.0), expressions.evaluate("cond(\"1\", missing, 2)", emptyMap()))
        assertEquals(null, expressions.evaluate("optional(\"1\", missing)", emptyMap()))
        val values = listOf(0.0 to "1970-01-01", -1.0 to "1969-12-31", 0.5 to "1970-01-01", -0.5 to "1969-12-31", 99999999.0 to "275760-09-12", 100000000.0 to "275760-09-13", 100000000.1 to "NaN-NaN-NaN", -100000000.0 to "-271821-04-20", -100000000.1 to "NaN-NaN-NaN", 1e30 to "NaN-NaN-NaN", Double.NaN to "NaN-NaN-NaN", Double.POSITIVE_INFINITY to "NaN-NaN-NaN")
        for((days, expected) in values) assertEquals(NativeToolInput.Text(expected), expressions.evaluate("addDays(\"1970-01-01\", days)", mapOf("days" to NativeToolInput.Number(days))))
        assertEquals(NativeToolInput.Text("0-01-01"), expressions.evaluate("addDays(\"0000-01-01\", 0)", emptyMap()))
        assertEquals(NativeToolInput.Text("1-01-01"), expressions.evaluate("addDays(\"0001-01-01\", 0)", emptyMap()))
    }

    @Test fun numericInteropCannotAuthorizeNewPathsTextOrLargerDistances() {
        val one = 1.0; val adjacent = Double.fromBits(one.toBits() + 1)
        assertTrue(approvedNumericInterop(Difference("measuredNumericPath", one, adjacent), 1))
        assertTrue(!approvedNumericInterop(Difference("newNumericPath", one, adjacent), null))
        assertTrue(!approvedNumericInterop(Difference("measuredNumericPath", one, Double.fromBits(one.toBits() + 2)), 1))
        assertTrue(!approvedNumericInterop(Difference("result.evaluation.status"), 1))
    }

    @Test fun downloadedAssessmentCannotEnableAnUndeclaredScoringMode() {
        val raw = json.parseToJsonElement(bankFile.readText()).jsonObject
        val rows = raw.getValue("records").jsonArray.toMutableList()
        val index = rows.indexOfFirst { it.jsonObject.getValue("kind").jsonPrimitive.content == "assessment" }
        val record = rows[index].jsonObject
        rows[index] = JsonObject(record + ("definition" to JsonObject(record.getValue("definition").jsonObject + ("scoringMode" to JsonPrimitive("responses-only")))))
        assertFailsWith<IllegalArgumentException> { NativeToolCore(JsonObject(raw + ("records" to JsonArray(rows))).toString(), NativeToolContext("2026-09-30")) }
    }

}
