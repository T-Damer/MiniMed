package dev.localmed.nativespike.shared.core

import dev.localmed.nativespike.shared.content.NativeCatalog
import dev.localmed.nativespike.shared.content.contentJson
import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.model.NativeSearchFilters
import dev.localmed.nativespike.shared.model.NativeSearchMode
import dev.localmed.nativespike.shared.model.NativeSearchScope
import dev.localmed.nativespike.shared.model.NativeSearchSelection
import dev.localmed.nativespike.shared.search.NativeSearchComposition
import dev.localmed.nativespike.shared.search.NativeSearchMount
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

class NativeMountedAdmissionTest {
    private fun edition(catalog: String,version: String,id: String?=null): String {
        val root=contentJson.parseToJsonElement(catalog).jsonObject
        val module=(root.getValue("modules") as JsonArray).single().jsonObject
        return JsonObject(root+("modules" to JsonArray(listOf(JsonObject(module+buildMap {
            put("version",JsonPrimitive(version));if(id!=null) put("id",JsonPrimitive(id))
        }))))).toString()
    }
    private fun combine(vararg catalogs: String): String {
        val roots=catalogs.map { contentJson.parseToJsonElement(it).jsonObject }
        return JsonObject(roots.first()+("modules" to JsonArray(roots.flatMap { (it.getValue("modules") as JsonArray).toList() }))).toString()
    }
    private fun io(name: String)=FixtureIO(SliceFixtures.root(name),mapOf("https://fixture.invalid/core.db" to SliceFixtures.core,"https://fixture.invalid/module.db" to SliceFixtures.module))

    @Test
    fun lastCommittedEditionWinsWithoutVersionGuessingAndFailedReplacementPreservesHistory(): Unit=runBlocking {
        val source=SliceFixtures.catalog()
        val catalog=combine(edition(source,"fixture.zz"),edition(source,"fixture.aa"),edition(SliceFixtures.catalog(wrongSource=true),"fixture.bad"))
        val parsed=NativeCatalog.parse(catalog)
        assertFailsWith<IllegalArgumentException> { NativeCatalog.parse(combine(source,source)) }
        val old=parsed.modules[0].documents().first().target
        val newest=parsed.modules[1].documents().first().target
        val bad=parsed.modules[2].documents().first().target
        assertNull(parsed.resolve(old.documentId,listOf(old.moduleId!!),null))
        assertNotNull(parsed.exact(old));assertNotNull(parsed.exact(newest))
        val io=io("mounted-editions")
        var core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        val selection=NativeSearchSelection(NativeSearchScope.LEGAL,NativeSearchFilters(documentIds=listOf(old.documentId)))
        try {
            assertIs<NativeDocumentResolution.Readable>(core.install(old))
            assertIs<NativeDocumentResolution.Readable>(core.install(newest))
            val active=assertNotNull(core.search("диспансерное наблюдение",NativeSearchMode.CLINICAL,selection))
            assertTrue(active.groups.isNotEmpty())
            assertTrue(active.groups.flatMap { it.items }.all { it.target?.moduleVersion==newest.moduleVersion })
            val historical=assertIs<NativeDocumentResolution.Readable>(core.openDocument(old)).document
            core.saveReaderSnapshot(NativeReaderRoute.Document(old,historical.sections.first().chunks.first().id,17))
            val saved=core.navigation.value
            val state=File(io.root,"native-content-state.json").readText()
            assertFailsWith<IllegalStateException> { core.install(bad) }
            assertEquals(state,File(io.root,"native-content-state.json").readText())
            assertEquals(saved,core.navigation.value)
            assertTrue(active.sourceGroups==assertNotNull(core.search("диспансерное наблюдение",NativeSearchMode.CLINICAL,selection)).sourceGroups,"Active source passages changed")
            core.close();io.offline=true
            core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
            assertEquals(saved,core.navigation.value)
            assertIs<NativeDocumentResolution.Readable>(assertIs<NativeReaderResolution.Document>(core.restoreReader()).resolution)
            assertTrue(active.sourceGroups==assertNotNull(core.search("диспансерное наблюдение",NativeSearchMode.CLINICAL,selection)).sourceGroups,"Active source passages changed")
        } finally { core.close() }
    }

    @Test
    fun savedDocumentPositionOpensAtomicallyAndFailureCannotPublishOrAlterRestart(): Unit=runBlocking {
        val catalog=SliceFixtures.catalog()
        val base=io("atomic-saved-reader")
        var failNext=false
        val io=object: NativeContentIO by base {
            override suspend fun writeTextAtomic(path: String,text: String) {
                if(failNext) { failNext=false;throw java.io.IOException("Injected private state write failure") }
                base.writeTextAtomic(path,text)
            }
        }
        val db=NativeSearchDatabase(SliceFixtures.core.path)
        val source=try { db.open();db.readSourceDocument(db.listSearchDocuments().single().id)!! } finally { db.close() }
        val first=NativeReaderRoute.Document(source.target.copy(anchor=source.sections.first().chunks.first().anchor),source.sections.first().chunks.first().id,17)
        var core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        try {
            assertIs<NativeDocumentResolution.Readable>(assertIs<NativeReaderResolution.Document>(core.openReader(first)).resolution)
            assertEquals(listOf(first),core.navigation.value.readers)
            val replacement=first.copy(offsetPx=42)
            core.openReader(replacement);assertEquals(listOf(replacement),core.navigation.value.readers)
            val before=core.navigation.value
            assertIs<NativeDocumentResolution.Unavailable>(assertIs<NativeReaderResolution.Document>(core.openReader(first.copy(target=first.target.copy(sourceChecksum="sha256:"+"0".repeat(64))))).resolution)
            assertEquals(before,core.navigation.value)
            failNext=true
            assertFailsWith<java.io.IOException> { core.openReader(first.copy(offsetPx=99)) }
            assertEquals(before,core.navigation.value)
            core.close();base.offline=true
            core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
            assertEquals(before,core.navigation.value)
            assertIs<NativeDocumentResolution.Readable>(assertIs<NativeReaderResolution.Document>(core.restoreReader()).resolution)
        } finally { core.close() }
    }

    @Test
    fun duplicatePackInstallCannotCommitOrDamagePreviouslyVerifiedSource(): Unit=runBlocking {
        val source=SliceFixtures.catalog()
        val catalog=combine(source,edition(source,"fixture.other","minimed.test.duplicate.pack"))
        val targets=NativeCatalog.parse(catalog).modules.map { it.documents().first().target }
        val io=io("mounted-pack-collision")
        val core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        try {
            val readable=assertIs<NativeDocumentResolution.Readable>(core.install(targets[0]))
            val state=File(io.root,"native-content-state.json").readText()
            assertFailsWith<IllegalArgumentException> { core.install(targets[1]) }
            assertEquals(state,File(io.root,"native-content-state.json").readText())
            assertTrue(readable==core.openDocument(targets[0]),"Previously verified source changed")
            assertIs<NativeDocumentResolution.Download>(core.resolveDocument(targets[1].documentId,expectedTarget=targets[1]))
            assertTrue(File(io.root,"staging").listFiles().orEmpty().isEmpty())
        } finally { core.close() }
    }

    @Test
    fun exactTupleAndDefinitionCapabilitiesRejectBeforeGenericAdmission() {
        val core=NativeSearchDatabase(SliceFixtures.core.path)
        val reference=NativeSearchDatabase(File(SliceFixtures.repository,"playwright/native-current-reference.db").path)
        core.open();reference.open()
        try {
            val identity=core.documentVersionIdentities().first()
            val target=NativeDocumentTarget(identity.documentId,identity.versionId,identity.sourceChecksum,moduleId="fixture",moduleVersion="one")
            assertFailsWith<IllegalArgumentException> { NativeSearchComposition(listOf(NativeSearchMount(core,"fixture","one",expectedSources=listOf(target.copy(sourceChecksum="sha256:"+"0".repeat(64)))))) }
            assertFailsWith<IllegalArgumentException> { NativeSearchComposition(listOf(NativeSearchMount(reference,"definition"))) }
            assertFailsWith<IllegalArgumentException> { dev.localmed.nativespike.shared.content.validateTarget(target.copy(anchor="foreign\u0000anchor")) }
            assertFailsWith<IllegalArgumentException> { dev.localmed.nativespike.shared.content.validateTarget(target.copy(moduleVersion="v".repeat(2049))) }
        } finally { reference.close();core.close() }
    }

    @Test
    fun alteredAliasWeightRejectsCompositionWithoutChangingOriginalSource() {
        val prepared=File(SliceFixtures.directory,"alias-conflict-prepared").also { it.mkdirs() }
        File(SliceFixtures.directory,"prepared").listFiles()!!.forEach { it.copyTo(File(prepared,it.name),overwrite=true) }
        val aliases=File(prepared,"aliases.yaml")
        aliases.writeText(aliases.readText().replaceFirst("weight: 1.0","weight: 0.5"))
        val generated=File(SliceFixtures.directory,"alias-conflict-core.db")
        val process=ProcessBuilder("uv","run","--project","tools/ingest","medbase","build","--input",prepared.path,"--output",generated.path,"--report",File(SliceFixtures.directory,"alias-conflict-report.json").path).directory(SliceFixtures.repository)
        process.environment().clear();process.environment().putAll(mapOf("HOME" to System.getProperty("user.home"),"PATH" to "/Users/d/.bun/bin:/Users/d/.local/bin:/opt/homebrew/bin:/usr/bin:/bin","TMPDIR" to File(SliceFixtures.repository,"playwright").path,"LANG" to "en_US.UTF-8"))
        process.redirectErrorStream(true);process.redirectOutput(File(SliceFixtures.directory,"alias-conflict-build.log"))
        assertEquals(0,process.start().waitFor(),"Source-built admission fixture failed")
        val original=NativeSearchDatabase(SliceFixtures.core.path)
        val conflict=NativeSearchDatabase(generated.path)
        val module=NativeSearchDatabase(SliceFixtures.module.path)
        original.open();conflict.open();module.open()
        try {
            assertEquals(original.documentVersionIdentities(),conflict.documentVersionIdentities())
            val id=original.listSearchDocuments().single().id
            assertTrue(original.readSourceDocument(id)==conflict.readSourceDocument(id),"Original source fields changed")
            val error=assertFailsWith<IllegalArgumentException> { NativeSearchComposition(listOf(NativeSearchMount(conflict,"core",weight=1.1),NativeSearchMount(module,"module","one"))) }
            assertEquals("Conflicting active alias identity",error.message)
        } finally { module.close();conflict.close();original.close() }
    }

    @Test
    fun forcedGeneratedChunkCollisionCannotDeduplicateHitsOrSubstituteSourceText() {
        val root=SliceFixtures.root("chunk-collision")
        val copy=File(root,"module.db")
        val core=NativeSearchDatabase(SliceFixtures.core.path)
        val original=NativeSearchDatabase(SliceFixtures.module.path)
        core.open();original.open()
        val collision=core.searchBranch("диспансер*",20).first().chunkId
        val replaced=original.searchBranch("диспансер*",20).first().chunkId
        original.close()
        // Explicit test-only ID fault injection into an owned copy; source rows remain verbatim.
        val script="""
            import sqlite3,shutil,sys,hashlib,json
            from localmed_ingest.sqlite_builder import rebuild_chunks_fts_index,chunks_fts_uses_external_content,verify_chunks_fts
            shutil.copyfile(sys.argv[1],sys.argv[2])
            db=sqlite3.connect(sys.argv[2]);db.execute('PRAGMA foreign_keys=ON');db.execute('BEGIN');db.execute('PRAGMA defer_foreign_keys=ON')
            old,new=sys.argv[3:5]
            columns=[r[1] for r in db.execute('PRAGMA table_info(chunks)') if r[1]!='id']
            fields=','.join(columns)
            before=db.execute('SELECT '+fields+' FROM chunks WHERE id=?',(old,)).fetchone()
            for table, in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
                for fk in db.execute('PRAGMA foreign_key_list("'+table+'")').fetchall():
                    if fk[2]=='chunks' and fk[4]=='id':
                        db.execute('UPDATE "'+table+'" SET "'+fk[3]+'"=? WHERE "'+fk[3]+'"=?',(new,old))
            db.execute('UPDATE chunks SET id=? WHERE id=?',(new,old))
            after=db.execute('SELECT '+fields+' FROM chunks WHERE id=?',(new,)).fetchone()
            assert before==after, 'Original source fields changed'
            if chunks_fts_uses_external_content(db):
                rebuild_chunks_fts_index(db)
            else:
                db.execute('UPDATE chunks_fts SET chunk_id=? WHERE chunk_id=?',(new,old))
            verify_chunks_fts(db);db.commit()
            assert not db.execute('PRAGMA foreign_key_check').fetchall()
            assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
            print(json.dumps({'injectedChunkId':new,'replacedChunkId':old,'originalFieldsUnchanged':True,'originalTextSha256':hashlib.sha256(before[columns.index('original_text')].encode()).hexdigest()}))
        """.trimIndent()
        val process=ProcessBuilder("uv","run","--project","tools/ingest","python","-c",script,SliceFixtures.module.path,copy.path,replaced,collision).directory(SliceFixtures.repository)
        process.environment().clear();process.environment().putAll(mapOf("HOME" to System.getProperty("user.home"),"PATH" to "/Users/d/.bun/bin:/Users/d/.local/bin:/opt/homebrew/bin:/usr/bin:/bin","TMPDIR" to File(SliceFixtures.repository,"playwright").path,"LANG" to "en_US.UTF-8"))
        process.redirectErrorStream(true);process.redirectOutput(File(SliceFixtures.repository,"playwright/native-mounted-collision-injection.json"))
        val injected=NativeSearchDatabase(copy.path)
        try {
            assertEquals(0,process.start().waitFor(),"Test-only collision injection failed")
            injected.open()
            val mounts=listOf(NativeSearchMount(core,"core",weight=1.1),NativeSearchMount(injected,"module","one"))
            assertFailsWith<IllegalArgumentException> { NativeSearchComposition(listOf(mounts[0],mounts[1].copy(moduleId="core"))) }
            val world=NativeSearchComposition(mounts)
            assertEquals("Duplicate active chunk identity",assertFailsWith<IllegalArgumentException> { world.search("диспансер*",60,NativeSearchFilters(),false) }.message)
            assertEquals("Duplicate requested source text identity",assertFailsWith<IllegalArgumentException> { world.texts(listOf(collision)) }.message)
        } finally { injected.close();core.close();root.deleteRecursively() }
    }

    @Test
    fun largeDocumentSelectionUsesOneJsonBindingAndFiltersExactFallbackBeforeWindow() {
        val db=NativeSearchDatabase(SliceFixtures.core.path);db.open()
        try {
            val document=db.listSearchDocuments().single()
            val ids=(0 until 30_000).map { "absent-$it" }+document.id
            val expected=db.searchBranch("диспансер*",20,filters=NativeSearchFilters(documentIds=listOf(document.id)))
            assertTrue(expected.isNotEmpty())
            assertEquals(expected,db.searchBranch("диспансер*",20,filters=NativeSearchFilters(documentIds=ids)))
            assertNotNull(db.firstReadableChunk(document.id,NativeSearchFilters(documentIds=ids)))
            for(filters in listOf(NativeSearchFilters(sectionTypes=listOf("absent")),NativeSearchFilters(specialties=listOf("absent")),NativeSearchFilters(ageGroups=listOf("absent")),NativeSearchFilters(documentIds=listOf("absent")))) {
                assertTrue(db.searchBranch("диспансер*",20,filters=filters).isEmpty())
                assertNull(db.firstReadableChunk(document.id,filters))
            }
        } finally { db.close() }
    }
}
