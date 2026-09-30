package dev.localmed.nativespike.shared.core

import dev.localmed.nativespike.shared.content.NativeCatalog
import dev.localmed.nativespike.shared.content.contentJson
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import dev.localmed.nativespike.shared.golden.testCoreDbPath
import dev.localmed.nativespike.shared.model.NativeSearchFilters
import dev.localmed.nativespike.shared.model.NativeSearchMode
import dev.localmed.nativespike.shared.model.NativeSearchScope
import dev.localmed.nativespike.shared.model.NativeSearchSelection
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

class NativeMountedCoreTest {
    /** A real verified private cache without a second 440 MB copy or writable source handle. */
    private fun cachedIO(name: String): FixtureIO {
        val root=SliceFixtures.root(name)
        val cache=File(root,"content/${NativeMedicalCore.RELEASE_CORE.decodedSha256.removePrefix("sha256:")}.db")
        cache.parentFile.mkdirs();Files.createLink(cache.toPath(),File(testCoreDbPath()).toPath())
        return FixtureIO(root,mapOf("https://fixture.invalid/module.db" to File(SliceFixtures.repository,"playwright/native-verified-regulatory.db")))
    }

    @Test
    fun actualVerifiedInstallRefreshesBothModesAndRetainsExactSelectionReaderAcrossOfflineReload(): Unit = runBlocking {
        val module=File(SliceFixtures.repository,"playwright/native-verified-regulatory.db")
        val catalog=SliceFixtures.catalog(SliceFixtures.artifact(module,"https://fixture.invalid/module.db"))
        val target=NativeCatalog.parse(catalog).modules.single().documents().first().target
        val selection=NativeSearchSelection(NativeSearchScope.LEGAL,NativeSearchFilters(documentIds=listOf(target.documentId)))
        val io=cachedIO("mounted-core-reload")
        var core=NativeMedicalCore.open(io,catalog);core.awaitReady()
        val identityCase=contentJson.parseToJsonElement(File(System.getProperty("TEST_RESOURCE_DIR"),"core-identities-golden.json").readText()).jsonObject.getValue("cases").jsonArray.first { row ->
            row.jsonObject.getValue("hits").jsonArray.any { it.jsonObject.getValue("target").jsonObject.getValue("type").jsonPrimitive.content=="document" }
        }.jsonObject
        val identityQuery=identityCase.getValue("query").jsonPrimitive.content
        val identities=core.lookupIdentities(identityQuery)
        val identity=(identities.first { it.target is NativeCoreIdentityTarget.Document }.target as NativeCoreIdentityTarget.Document)
        assertTrue(identities.isNotEmpty())
        val exactIds=core.lookupIdentities(identityQuery,NativeSearchSelection(filters=NativeSearchFilters(documentIds=listOf(identity.documentId))))
        assertTrue(exactIds.isNotEmpty() && exactIds.all { it.target is NativeCoreIdentityTarget.Document && it.target.documentId==identity.documentId })
        assertTrue(core.lookupIdentities(identityQuery,NativeSearchSelection(NativeSearchScope.PERSONAL)).isEmpty())
        assertTrue(core.lookupIdentities(identityQuery,NativeSearchSelection(filters=NativeSearchFilters(documentIds=listOf("absent")))).isEmpty())
        assertTrue(core.lookupIdentities(identityQuery,NativeSearchSelection(filters=NativeSearchFilters(specialties=listOf("pediatrics")))).isEmpty())
        for(mode in NativeSearchMode.entries) assertTrue(assertNotNull(core.search("диспансерное наблюдение",mode,selection)).sourceGroups.isEmpty())
        assertIs<NativeDocumentResolution.Readable>(core.install(target))
        val mode=NativeSearchMode.CLINICAL
        val result=assertNotNull(core.search("диспансерное наблюдение",mode,selection))
        assertEquals(selection,result.selection);assertTrue(result.sourceGroups.isNotEmpty())
        val exact=assertNotNull(result.groups.first().items.first().target)
        assertEquals(target.moduleId,exact.moduleId);assertEquals(target.moduleVersion,exact.moduleVersion)
        assertEquals(target.documentVersionId,exact.documentVersionId);assertEquals(target.sourceChecksum,exact.sourceChecksum)
        val read=assertIs<NativeDocumentResolution.Readable>(core.openDocument(exact)).document
        assertTrue(read.sections.any { it.anchor==exact.anchor || it.chunks.any { chunk -> chunk.anchor==exact.anchor } })
        assertIs<NativeDocumentResolution.Unavailable>(core.resolveDocument(exact.documentId,expectedTarget=exact.copy(sourceChecksum="sha256:"+"0".repeat(64))))
        val saved=NativeSearchSnapshot("диспансерное наблюдение",4,19,mode,selection)
        core.saveSearchSnapshot(saved)
        val before=core.navigation.value
        val invalid=selection.copy(filters=NativeSearchFilters(documentIds=listOf("invalid\u0000ID")))
        assertFailsWith<IllegalArgumentException> { core.search(saved.query,mode,invalid) }
        assertFailsWith<IllegalArgumentException> { core.saveSearchSnapshot(saved.copy(selection=invalid)) }
        assertEquals(before,core.navigation.value)
        core.close();io.offline=true
        core=NativeMedicalCore.open(io,catalog)
        try {
            assertEquals(saved,core.navigation.value.search)
            assertIs<NativeDocumentResolution.Readable>(assertIs<NativeReaderResolution.Document>(core.restoreReader()).resolution)
            val restored=assertNotNull(core.search(saved.query,saved.mode,saved.selection))
            assertTrue(result.sourceGroups==restored.sourceGroups,"Offline source passages changed")
            assertEquals(1,io.downloads)
        } finally { core.close() }
    }

    @Test
    fun blockedInstallDoesNotHoldSearchGateAndCancellationNeverAdmitsUncommittedSource(): Unit = runBlocking {
        val module=File(SliceFixtures.repository,"playwright/native-verified-regulatory.db")
        val catalog=SliceFixtures.catalog(SliceFixtures.artifact(module,"https://fixture.invalid/module.db"))
        val target=NativeCatalog.parse(catalog).modules.single().documents().first().target
        val selection=NativeSearchSelection(NativeSearchScope.LEGAL,NativeSearchFilters(documentIds=listOf(target.documentId)))
        val io=cachedIO("mounted-core-cancel")
        val core=NativeMedicalCore.open(io,catalog);core.awaitReady()
        try {
            io.started=CompletableDeferred();io.release=CompletableDeferred()
            val installing=async { core.install(target) }
            io.started!!.await()
            val whileBlocked=withTimeout(5_000) { core.search("диспансерное наблюдение",NativeSearchMode.LOOKUP,selection) }
            assertTrue(assertNotNull(whileBlocked).sourceGroups.isEmpty())
            installing.cancelAndJoin()
            assertTrue(assertNotNull(core.search("диспансерное наблюдение",NativeSearchMode.CLINICAL,selection)).sourceGroups.isEmpty())
            assertIs<NativeDocumentResolution.Download>(core.resolveDocument(target.documentId,expectedTarget=target))
            assertTrue(File(io.root,"staging").listFiles().orEmpty().isEmpty())
            assertTrue(!File(io.root,"native-content-state.json").exists())
        } finally { core.close() }
    }
}
