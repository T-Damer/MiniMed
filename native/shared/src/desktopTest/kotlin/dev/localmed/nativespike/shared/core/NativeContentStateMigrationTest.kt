package dev.localmed.nativespike.shared.core

import dev.localmed.nativespike.shared.content.JVMContentIO
import dev.localmed.nativespike.shared.content.contentJson
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private class StateIO(root: File): NativeContentIO by JVMContentIO(root.path) {
    private val files=JVMContentIO(root.path)
    var writes=0
    var cancelAfterWrite=false
    override suspend fun writeTextAtomic(path: String,text: String) {
        files.writeTextAtomic(path,text);writes++
        if(cancelAfterWrite) { cancelAfterWrite=false;throw CancellationException("Injected atomic-write cancellation") }
    }
}
private const val statePath="native-content-state.json"
private fun stateDirectory(name: String)=File(System.getProperty("NATIVE_SLICE_ROOT"),"playwright/native-state-fixtures/$name").also { it.deleteRecursively();it.mkdirs() }
private fun schema1(explicit: Boolean=false): String = """{
    ${if(explicit) "\"schemaVersion\":1," else ""}
    "installed":[{"moduleId":"source.module","moduleVersion":"1","sourceSetDigest":"sha256:${"a".repeat(64)}","artifact":{"id":"index","url":"https://fixture.invalid/index","sha256":"sha256:${"b".repeat(64)}","sizeBytes":1},"path":"content/${"b".repeat(64)}.db"}],
    "navigation":{"search":{"query":"saved query","firstVisibleItemIndex":5,"firstVisibleItemOffset":17},"readers":[{"target":{"documentId":"source","documentVersionId":"source@1","sourceChecksum":"sha256:${"c".repeat(64)}","anchor":"original-anchor","moduleId":"source.module","moduleVersion":"1"},"chunkId":"original-chunk","offsetPx":44}],"catalog":{"moduleId":"source.module","moduleVersion":"1","filterQuery":"member filter","firstVisibleItemIndex":2,"firstVisibleItemOffset":9,"overviewFilterQuery":"module filter","overviewFirstVisibleItemIndex":7,"overviewFirstVisibleItemOffset":31}}
}"""

class NativeContentStateMigrationTest {
    @Test
    fun recordedSchema1MigrationPreservesRegistryQueryTrailAndIntermediateCatalogFilters(): Unit = runBlocking {
        for(explicit in listOf(false,true)) {
            val io=StateIO(stateDirectory("preserve-$explicit"))
            io.writeTextAtomic(statePath,schema1(explicit));io.writes=0
            val state=loadNativeContentState(io,statePath)
            assertEquals(2,state.schemaVersion);assertEquals(1,state.installed.size)
            assertEquals(NativeSearchSnapshot("saved query",5,17),state.navigation.search)
            val route=assertIs<NativeReaderRoute.Document>(state.navigation.readers.single())
            assertEquals("original-anchor",route.target.anchor);assertEquals("original-chunk",route.chunkId);assertEquals(44,route.offsetPx)
            val catalog=state.navigation.catalog!!
            assertEquals("member filter",catalog.filterQuery);assertEquals("module filter",catalog.overviewFilterQuery)
            assertEquals(7,catalog.overviewFirstVisibleItemIndex);assertEquals(31,catalog.overviewFirstVisibleItemOffset)
            assertEquals("2",contentJson.parseToJsonElement(io.readText(statePath)).jsonObject["schemaVersion"]!!.jsonPrimitive.content)
            assertEquals(state,loadNativeContentState(io,statePath));assertEquals(1,io.writes)
            val longQuery="x".repeat(20000)
            io.writeTextAtomic(statePath,schema1(explicit).replace("saved query",longQuery))
            assertEquals(longQuery,loadNativeContentState(io,statePath).navigation.search.query)
            val definition=NativeReaderRoute.Definition(NativeDefinitionTarget("source.reference","1","entity","edition"),"entity.reference.000001",4096,3,11)
            val mixed=state.copy(navigation=state.navigation.copy(readers=state.navigation.readers+definition))
            io.writeTextAtomic(statePath,contentJson.encodeToString(mixed))
            assertEquals(mixed,loadNativeContentState(io,statePath))
        }
    }
    @Test
    fun unknownMalformedSchemaAndCancellationPreserveOriginalPrivateBytes(): Unit = runBlocking {
        val io=StateIO(stateDirectory("rejection"))
        for(raw in listOf(schema1().replace("\"navigation\":","\"schemaVersion\":99,\"navigation\":"),schema1().replace("\"offsetPx\":44","\"offsetPx\":-1"),schema1().replace("\"navigation\":","\"unknown\":true,\"navigation\":"))) {
            io.writeTextAtomic(statePath,raw);val writes=io.writes
            assertFailsWith<Exception> { loadNativeContentState(io,statePath) }
            assertEquals(raw,io.readText(statePath));assertEquals(writes,io.writes)
        }
        val raw=schema1();io.writeTextAtomic(statePath,raw);io.cancelAfterWrite=true
        assertFailsWith<CancellationException> { loadNativeContentState(io,statePath) }
        assertEquals(raw,io.readText(statePath))
        val current=loadNativeContentState(io,statePath);assertEquals(2,current.schemaVersion)
    }
    @Test
    fun actualAndroidSchema1ProducerCopyCanBeConvertedWithoutChangingSavedState(): Unit = runBlocking {
        val original=File(System.getProperty("NATIVE_SLICE_ROOT"),"playwright/native-android-schema1-state.json")
        org.junit.Assume.assumeTrue("Real Android private-state snapshot is not available",original.isFile)
        val raw=original.readText();val io=StateIO(stateDirectory("actual-android"));io.writeTextAtomic(statePath,raw)
        val converted=loadNativeContentState(io,statePath)
        assertEquals(2,converted.schemaVersion)
        val before=contentJson.parseToJsonElement(raw).jsonObject["navigation"]!!.jsonObject
        val after=contentJson.parseToJsonElement(io.readText(statePath)).jsonObject["navigation"]!!.jsonObject
        assertEquals(before["search"],after["search"])
        assertEquals(before["catalog"]?.takeUnless { it==kotlinx.serialization.json.JsonNull },after["catalog"])
        val installed=File(System.getProperty("NATIVE_SLICE_ROOT"),"playwright/native-android-schema1-installed-state.json")
        if(installed.isFile) {
            val installedRaw=installed.readText();io.writeTextAtomic(statePath,installedRaw)
            val state=loadNativeContentState(io,statePath)
            val old=contentJson.parseToJsonElement(installedRaw).jsonObject
            val encoded=contentJson.parseToJsonElement(io.readText(statePath)).jsonObject
            assertEquals(old["installed"],encoded["installed"])
            val oldNavigation=old["navigation"]!!.jsonObject
            val encodedNavigation=encoded["navigation"]!!.jsonObject
            assertEquals(oldNavigation["search"],encodedNavigation["search"])
            assertEquals(oldNavigation["catalog"]?.takeUnless { it==kotlinx.serialization.json.JsonNull },encodedNavigation["catalog"])
            assertTrue(state.navigation.readers.all { it is NativeReaderRoute.Document })
            assertEquals(installedRaw,installed.readText())
        }
        assertEquals(raw,original.readText())
    }
}
