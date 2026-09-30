package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.content.bundledNativeTools
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class NativeHomeDataTest {
    @Test
    fun actualBundledHomePreservesSourceCountsToolRuntimeAndRussianEntities(): Unit = runBlocking {
        val data = bundledNativeHomeData()
        assertEquals(6, data.sections.size)
        assertEquals(4, data.features.size)
        assertTrue(data.features.flatMap { it.actions }.all { it.metadataOnly })
        val tools = bundledNativeTools().core()
        assertEquals("50\u00a0калькуляторов", data.sections.first { it.id == "calculators" }.countLabel(tools))
        assertEquals("19\u00a0опросников", data.sections.first { it.id == "assessments" }.countLabel(tools))
        val row = data.sections.first { it.id == "guidelines" }
        assertEquals("751\u00a0рекомендация", row.countLabel(tools))
        assertEquals("2\u00a0рекомендации", row.copy(navigationDocumentCount = 2).countLabel(tools))
        assertEquals("11\u00a0рекомендаций", row.copy(navigationDocumentCount = 11).countLabel(tools))
        assertEquals("1\u00a0021\u00a0рекомендация", row.copy(navigationDocumentCount = 1021).countLabel(tools))
        assertFailsWith<IllegalArgumentException> { parseNativeHomeData("{\"schemaVersion\":2}") }
        assertFailsWith<IllegalArgumentException> {
            parseNativeHomeData(Json.encodeToString(data.copy(sections = data.sections.map {
                if (it.id == "legal") it.copy(countEntity = "tool", countProvider = "native-tool-runtime", navigationDocumentCount = null, membershipSha256 = null) else it
            })))
        }
        assertFailsWith<IllegalArgumentException> {
            parseNativeHomeData(Json.encodeToString(data.copy(examplesByScope = data.examplesByScope - "all")))
        }
    }

    @Test
    fun daySelectionMatchesWebModuloIncludingPreEpochDays() {
        assertEquals(0, nativeHomeFeatureIndex(0, 31))
        assertEquals(3, nativeHomeFeatureIndex(4, -1))
        assertEquals(0, nativeHomeFeatureIndex(4, 20_728))
        assertEquals(1, nativeHomeFeatureIndex(4, 20_729))
    }
}
