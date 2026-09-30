package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.content.JVMContentIO
import dev.localmed.nativespike.shared.content.NativeToolsBundle
import dev.localmed.nativespike.shared.core.NativeContentIO
import dev.localmed.nativespike.shared.tools.NativeToolDefinition
import dev.localmed.nativespike.shared.tools.NativeToolKind
import dev.localmed.nativespike.shared.tools.searchTools
import dev.localmed.nativespike.shared.user.*
import java.io.File
import kotlinx.coroutines.runBlocking
import kotlin.test.*

class NativeToolsSessionTest {
    private val root = File(requireNotNull(System.getProperty("TEST_RESOURCE_DIR"))).canonicalFile.parentFile.parentFile.parentFile.parentFile.parentFile
    private fun profile() = File(root,"playwright/native-tools-state-${System.nanoTime()}").apply { mkdirs() }
    private fun bundle() = NativeToolsBundle(File(root,"native/shared/src/commonMain/composeResources/files/native-tool-data.json").readText())

    @Test fun homeToolSectionOpensTheMatchingCatalogBeforeCoreReadiness() = runBlocking {
        val profile = profile()
        val session = NativeCoreSession(JVMContentIO(profile.absolutePath), { error("Core must not open") }, this, { bundle() })
        try {
            assertTrue(session.openTools(NativeToolKind.Assessment))
            assertEquals(NativeToolKind.Assessment, session.toolsKind.value)
            assertEquals(19, requireNotNull(session.tools.value).searchTools("", session.toolsKind.value).size)
            assertTrue(session.openTools(NativeToolKind.Calculator))
            assertEquals(50, requireNotNull(session.tools.value).searchTools("", session.toolsKind.value).size)
            assertTrue(session.openTools())
            assertNull(session.toolsKind.value)
            assertEquals(69, requireNotNull(session.tools.value).searchTools("", session.toolsKind.value).size)
        } finally { session.close(); check(profile.deleteRecursively()) }
    }

    @Test fun toolsOpenBeforeCoreFavoriteAndCollectionsBackKeepDraftAndRestartResult() = runBlocking {
        val profile=profile();val io=JVMContentIO(profile.absolutePath)
        val session=NativeCoreSession(io,{error("Core must not open")},this,{bundle()})
        try {
            assertTrue(session.loadTools())
            val record=requireNotNull(session.tools.value).tools().first { it.definition is NativeToolDefinition.Calculator }
            assertTrue(session.openTool(record.id))
            val state=session.calculatorState(record)
            val input=state.inputs.keys.first()
            state.changeInput(input,"001.250")
            val result=session.evaluateTool(record.id,state.engineInputs(),state.stage)
            assertTrue(state.accept(state.snapshot(),result))
            assertTrue(session.saveTool(record))
            session.openCollections(nativeToolItem(record))
            assertEquals(NativeUserPanel.Collections,session.panel.value)
            assertTrue(session.back())
            assertEquals(NativeToolRoute.Tool(record.id,record.version,NativeToolEntry.Search),session.toolsState.snapshot.value?.route)
            assertEquals("001.250",session.calculatorState(record).inputs[input])
            session.openCollections()
            assertTrue(session.openCollectionItem(nativeToolItem(record)))
            assertNull(session.panel.value)
            session.close()
            val restored=NativeCoreSession(io,{error("Core must not open")},this,{bundle()})
            try {
                assertTrue(restored.loadTools())
                assertEquals(session.toolsState.snapshot.value,restored.toolsState.snapshot.value)
                assertEquals("001.250",restored.calculatorState(record).inputs[input])
                assertEquals(result,restored.calculatorState(record).result)
            } finally { restored.close() }
        } finally { session.close();check(profile.deleteRecursively()) }
    }

    @Test fun failedAtomicBackKeepsCurrentToolAndRetryUsesLatestDraft() = runBlocking {
        val profile=profile();val real=JVMContentIO(profile.absolutePath);var fail=false
        val io=object: NativeContentIO by real {
            override suspend fun writeTextAtomic(path: String,text: String) {
                if(fail && path=="native-tools-state.json") error("OS write failed")
                real.writeTextAtomic(path,text)
            }
        }
        val session=NativeCoreSession(io,{error("Core must not open")},this,{bundle()})
        try {
            assertTrue(session.loadTools())
            val record=requireNotNull(session.tools.value).tools().first { it.definition is NativeToolDefinition.Calculator }
            assertTrue(session.openTool(record.id))
            val state=session.calculatorState(record);val input=state.inputs.keys.first()
            session.registerNavigationFlush { session.saveTool(record) }
            state.changeInput(input,"12");fail=true
            val before=File(profile,"native-tools-state.json").readText()
            assertFalse(session.back())
            assertEquals(NativeToolRoute.Tool(record.id,record.version,NativeToolEntry.Search),session.toolsState.snapshot.value?.route)
            assertEquals(before,File(profile,"native-tools-state.json").readText())
            assertNotNull(session.uiErrors.messages.value[NativeUiOperation.ToolsState])
            state.changeInput(input,"34");fail=false
            assertTrue(session.back())
            assertNull(session.toolsState.snapshot.value?.route)
            assertEquals("34",session.toolsState.snapshot.value?.drafts?.single()?.calculator?.inputs?.get(input))
        } finally { session.close();check(profile.deleteRecursively()) }
    }

    @Test fun damagedPrivateToolsFileIsPreservedAndNoCatalogRouteIsPublished() = runBlocking {
        val profile=profile();val io=JVMContentIO(profile.absolutePath)
        try {
            for(raw in listOf("{}","not-json","{\"schemaVersion\":99,\"route\":null,\"query\":\"\",\"drafts\":[]}")) {
                File(profile,"native-tools-state.json").writeText(raw)
                val session=NativeCoreSession(io,{error("Core must not open")},this,{bundle()})
                try {
                    assertFalse(session.openTools())
                    assertNull(session.toolsState.snapshot.value)
                    assertEquals(raw,File(profile,"native-tools-state.json").readText())
                    assertNotNull(session.uiErrors.messages.value[NativeUiOperation.ToolsState])
                } finally { session.close() }
            }
        } finally { check(profile.deleteRecursively()) }
    }
    @Test fun exactEntrySurvivesFavoriteRestartAndCatalogBackRestoresQuery() = runBlocking {
        val profile=profile();val io=JVMContentIO(profile.absolutePath)
        var session=NativeCoreSession(io,{error("Core must not open")},this,{bundle()})
        try {
            assertTrue(session.loadTools())
            val record=requireNotNull(session.tools.value).tools().first { it.definition is NativeToolDefinition.Calculator }
            assertTrue(session.openTool(record.id))
            assertTrue(session.back())
            assertNull(session.toolsState.snapshot.value?.route)
            assertNull(session.panel.value)
            assertTrue(session.openTools())
            session.updateToolsQuery(record.title)
            assertTrue(session.saveToolsQuery())
            assertTrue(session.openTool(record.id,NativeToolEntry.Catalog))
            assertEquals(NativeToolEntry.Catalog,(session.toolsState.snapshot.value?.route as NativeToolRoute.Tool).entry)
            assertTrue(session.back())
            assertEquals(NativeToolRoute.Catalog,session.toolsState.snapshot.value?.route)
            assertEquals(record.title,session.toolsQuery.value)
            assertEquals(record.title,session.toolsState.snapshot.value?.query)
            val favorite=nativeToolItem(record)
            assertTrue(session.loadCollections())
            session.collectionsState.toggleFavorite(favorite,"2026-09-30T00:00:00Z")
            session.openCollections()
            assertTrue(session.openCollectionItem(favorite))
            assertEquals(NativeToolEntry.Collections,(session.toolsState.snapshot.value?.route as NativeToolRoute.Tool).entry)
            session.close()
            session=NativeCoreSession(io,{error("Core must not open")},this,{bundle()})
            assertTrue(session.loadTools())
            assertTrue(session.back())
            assertNull(session.toolsState.snapshot.value?.route)
            assertEquals(NativeUserPanel.Collections,session.panel.value)
            assertEquals(favorite.id,session.collectionsState.snapshot.value?.favorites?.single()?.id)
        } finally { session.close();check(profile.deleteRecursively()) }
    }
}
