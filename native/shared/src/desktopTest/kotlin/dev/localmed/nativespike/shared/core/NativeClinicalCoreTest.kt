package dev.localmed.nativespike.shared.core

import dev.localmed.nativespike.shared.model.NativeSearchMode
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class NativeClinicalCoreTest {
    @Test
    fun explicitClinicalApiPreservesSourceResultsAndState2ModeAcrossOfflineRestart(): Unit = runBlocking {
        val catalog=SliceFixtures.catalog()
        val io=FixtureIO(SliceFixtures.root("clinical-mode"),mapOf("https://fixture.invalid/core.db" to SliceFixtures.core))
        var core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        core.awaitReady()
        val query="диспансерное наблюдение"
        val lookup=assertNotNull(core.search(query))
        assertEquals(NativeSearchMode.LOOKUP,lookup.mode)
        for(mode in NativeSearchMode.entries) {
            var callbackSql=0.0
            val timed=assertNotNull(core.search(query,mode) { stage,ms -> if(stage=="sql") callbackSql+=ms })
            assertEquals(callbackSql,timed.timing.sqlOnlyMs)
            assertTrue(timed.timing.totalMs>=timed.timing.sqlOnlyMs)
        }
        val clinical=assertNotNull(core.search(query,NativeSearchMode.CLINICAL))
        assertEquals(NativeSearchMode.CLINICAL,clinical.mode)
        assertEquals(query,assertNotNull(clinical.analysis).originalQuery)
        assertTrue(clinical.sourceGroups.isNotEmpty())
        assertEquals(clinical.groups.map { it.documentId },clinical.sourceGroups.map { it.documentId })
        assertTrue(clinical.sourceGroups.flatMap { it.results }.all { it.anchor.isNotEmpty() && it.documentVersionId.isNotEmpty() && it.snippet.isNotEmpty() })
        core.openCatalog("minimed.regulatory.pediatrics.ru","0.3.4-preview.1")
        core.openDocument(SliceFixtures.target(catalog))
        core.saveSearchSnapshot(NativeSearchSnapshot(query,3,27,NativeSearchMode.CLINICAL))
        val saved=core.navigation.value
        for(invalid in listOf("x".repeat(NATIVE_SEARCH_QUERY_MAX_LENGTH+1),"invalid\u0000query")) {
            assertFailsWith<IllegalArgumentException> { core.search(invalid,NativeSearchMode.CLINICAL) }
            assertFailsWith<IllegalArgumentException> { core.analyzeClinicalQuery(invalid) }
            assertFailsWith<IllegalArgumentException> { core.saveSearchSnapshot(NativeSearchSnapshot(invalid,mode=NativeSearchMode.CLINICAL)) }
            assertEquals(saved,core.navigation.value)
        }
        core.close()
        assertFailsWith<IllegalStateException> { core.search(query,NativeSearchMode.CLINICAL) }
        io.offline=true
        core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        try {
            assertEquals(saved,core.navigation.value)
            assertEquals(NativeSearchMode.CLINICAL,core.navigation.value.search.mode)
            assertNotNull(core.search(query,core.navigation.value.search.mode))
        } finally { core.close() }
    }
}
