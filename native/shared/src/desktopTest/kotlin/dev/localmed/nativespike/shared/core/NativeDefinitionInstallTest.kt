package dev.localmed.nativespike.shared.core

import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.content.NativeCatalog
import dev.localmed.nativespike.shared.content.bundledNativeCatalog
import dev.localmed.nativespike.shared.content.contentJson
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

private object ReferenceFixture {
    val file=File(SliceFixtures.directory,"reference-subset.db")
    val entity: String
    val sourceSetDigest: String
    init {
        file.delete()
        val script="""
            import sqlite3,json,hashlib,sys
            from localmed_ingest.sqlite_builder import schema_sql,rebuild_chunks_fts_index
            source=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
            fixture=sqlite3.connect(sys.argv[2]);fixture.executescript(schema_sql())
            fixture.execute('PRAGMA foreign_keys=ON');fixture.execute('PRAGMA defer_foreign_keys=ON')
            entity=source.execute('WITH sizes AS (SELECT v.document_id,sum(length(c.original_text)) AS chars FROM chunks c JOIN document_versions v ON v.id=c.document_version_id GROUP BY v.document_id), offers AS (SELECT entity_id,min(document_id) AS source,count(*) AS blocks FROM definition_reference_links GROUP BY entity_id HAVING count(DISTINCT document_id)=1 AND count(*)>=9) SELECT o.entity_id FROM offers o JOIN sizes s ON s.document_id=o.source ORDER BY s.chars,o.blocks,o.entity_id LIMIT 1').fetchone()[0]
            def copy(table,where='',args=()):
                cols=[r[1] for r in source.execute('PRAGMA table_info('+table+')')]
                fields=','.join(cols);rows=source.execute('SELECT '+fields+' FROM '+table+where,args).fetchall()
                fixture.executemany('INSERT INTO '+table+'('+fields+') VALUES('+','.join('?' for _ in cols)+')',rows)
                actual=fixture.execute('SELECT '+fields+' FROM '+table).fetchall()
                assert len(rows)==len(actual) and set(rows)==set(actual), table+' row mismatch'
            copy('content_packs')
            links='SELECT chunk_id FROM definition_reference_links WHERE entity_id=?'
            copy('documents',' WHERE id IN (SELECT document_id FROM definition_reference_links WHERE entity_id=?)',(entity,))
            copy('document_versions',' WHERE document_id IN (SELECT document_id FROM definition_reference_links WHERE entity_id=?)',(entity,))
            copy('sections',' WHERE document_version_id IN (SELECT id FROM document_versions WHERE document_id IN (SELECT document_id FROM definition_reference_links WHERE entity_id=?))',(entity,))
            copy('chunks',' WHERE document_version_id IN (SELECT id FROM document_versions WHERE document_id IN (SELECT document_id FROM definition_reference_links WHERE entity_id=?))',(entity,))
            copy('knowledge_entities',' WHERE id=?',(entity,))
            copy('knowledge_names',' WHERE entity_id=?',(entity,))
            copy('knowledge_fts',' WHERE entity_id=?',(entity,))
            copy('knowledge_document_links',' WHERE entity_id=?',(entity,))
            copy('definition_reference_entity_keys',' WHERE entity_id=?',(entity,))
            copy('definition_reference_chunk_keys',' WHERE chunk_id IN ('+links+')',(entity,))
            copy('definition_reference_compact_links',' WHERE entity_key IN (SELECT local_id FROM definition_reference_entity_keys WHERE entity_id=?)',(entity,))
            manifest=json.loads(source.execute("SELECT value FROM app_metadata WHERE key='definition_reference'").fetchone()[0])
            manifest.update(entries=1,sources=fixture.execute('SELECT count(*) FROM documents').fetchone()[0],blocks=fixture.execute('SELECT count(*) FROM chunks').fetchone()[0])
            encoded=json.dumps(manifest,ensure_ascii=False,separators=(',',':'))
            fixture.execute("INSERT INTO app_metadata(key,value) VALUES('definition_reference',?)",(encoded,))
            fixture.execute('UPDATE content_packs SET checksum=?',('sha256:'+hashlib.sha256(encoded.encode()).hexdigest(),))
            rebuild_chunks_fts_index(fixture)
            fixture.execute("INSERT INTO definition_reference_fts(definition_reference_fts) VALUES ('rebuild')")
            fixture.commit()
            assert not fixture.execute('PRAGMA foreign_key_check').fetchall()
            assert fixture.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
            inventory=[{'documentId':r[0],'documentVersionId':r[1],'sourceChecksum':r[2]} for r in fixture.execute('SELECT document_id,id,source_checksum FROM document_versions ORDER BY document_id,id')]
            descriptor='sha256:'+hashlib.sha256(json.dumps(inventory,ensure_ascii=False,separators=(',',':'),sort_keys=True).encode()).hexdigest()
            open(sys.argv[3],'w').write(json.dumps({'entityId':entity,'sourceSetDigest':descriptor}))
        """.trimIndent()
        val id=File(SliceFixtures.directory,"reference-subset-entity.txt")
        val process=ProcessBuilder("uv","run","--project","tools/ingest","python","-c",script,System.getProperty("NATIVE_REFERENCE_DB_PATH"),file.path,id.path).directory(SliceFixtures.repository)
        process.environment().clear();process.environment().putAll(mapOf("HOME" to System.getProperty("user.home"),"PATH" to "/Users/d/.bun/bin:/Users/d/.local/bin:/opt/homebrew/bin:/usr/bin:/bin","TMPDIR" to File(SliceFixtures.repository,"playwright").path,"LANG" to "en_US.UTF-8"))
        process.redirectErrorStream(true);process.redirectOutput(File(SliceFixtures.directory,"reference-subset.log"))
        check(process.start().waitFor()==0) { "Verbatim reference subset failed; see playwright/native-core-fixtures/reference-subset.log" }
        val descriptor=contentJson.parseToJsonElement(id.readText()).jsonObject
        entity=(descriptor["entityId"] as JsonPrimitive).content
        sourceSetDigest=(descriptor["sourceSetDigest"] as JsonPrimitive).content
    }
    suspend fun catalog(): String {
        val root=contentJson.parseToJsonElement(bundledNativeCatalog()).jsonObject
        val original=(root["modules"] as JsonArray).single { it.jsonObject["id"]==JsonPrimitive("minimed.definition.reference.ru") }.jsonObject
        val artifact=original["artifacts"]!!.let { it as JsonArray }.single { it.jsonObject["kind"]==JsonPrimitive("index") }.jsonObject
        val descriptor=JsonObject(artifact+mapOf("url" to JsonPrimitive("https://fixture.invalid/reference.db"),"compression" to JsonPrimitive("none"),"sha256" to JsonPrimitive(SliceFixtures.digest(file)),"sizeBytes" to JsonPrimitive(file.length()),"decodedSha256" to JsonPrimitive(SliceFixtures.digest(file)),"decodedSizeBytes" to JsonPrimitive(file.length()),"sourceSetDigest" to JsonPrimitive(sourceSetDigest)))
        val reference=original["definitionReference"]!!.jsonObject
        val module=JsonObject(original+mapOf("sourceSetDigest" to JsonPrimitive(sourceSetDigest),"artifacts" to JsonArray(listOf(descriptor)),"definitionReference" to JsonObject(reference+("entries" to JsonPrimitive(1)))))
        return JsonObject(root+("modules" to JsonArray(listOf(module)))).toString()
    }
    fun target()=NativeDefinitionTarget("minimed.definition.reference.ru","2026.9.30",entity,"minimed.definition.reference.2026.9.30")
}

class NativeDefinitionInstallTest {
    @Test
    fun exactSavedDefinitionPositionIsOneCommitAndSurvivesWriteFailureAndOfflineRestart(): Unit=runBlocking {
        val catalog=ReferenceFixture.catalog();val target=ReferenceFixture.target()
        val base=FixtureIO(SliceFixtures.root("atomic-definition-reader"),mapOf("https://fixture.invalid/core.db" to SliceFixtures.core,"https://fixture.invalid/reference.db" to ReferenceFixture.file))
        var failNext=false
        val io=object: NativeContentIO by base {
            override suspend fun writeTextAtomic(path: String,text: String) {
                if(failNext) { failNext=false;throw java.io.IOException("Injected private state write failure") }
                base.writeTextAtomic(path,text)
            }
        }
        var core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        try {
            core.installDefinition(target)
            val block=core.definitionBlocks(target).blocks.first()
            val saved=NativeReaderRoute.Definition(target,block.linkId,0,2,19)
            assertIs<NativeDefinitionResolution.Readable>(assertIs<NativeReaderResolution.Definition>(core.openReader(saved)).resolution)
            assertEquals(listOf(saved),core.navigation.value.readers)
            val replacement=saved.copy(firstVisibleItemOffset=41)
            core.openReader(replacement);assertEquals(listOf(replacement),core.navigation.value.readers)
            val before=core.navigation.value
            assertIs<NativeDefinitionResolution.Unavailable>(assertIs<NativeReaderResolution.Definition>(core.openReader(saved.copy(target=target.copy(moduleVersion="2026.9.27")))).resolution)
            assertEquals(before,core.navigation.value)
            failNext=true
            assertFailsWith<java.io.IOException> { core.openReader(saved) }
            assertEquals(before,core.navigation.value)
            core.close();base.offline=true
            core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
            assertEquals(before,core.navigation.value)
            assertIs<NativeDefinitionResolution.Readable>(assertIs<NativeReaderResolution.Definition>(core.restoreReader()).resolution)
        } finally { core.close() }
    }

    @Test
    fun wholeEditionConsentInstallSearchAndOfflineRestoreNeedsNoInventedEntity(): Unit = runBlocking {
        val catalog=ReferenceFixture.catalog();val edition=ReferenceFixture.target().editionTarget()
        val io=FixtureIO(SliceFixtures.root("definition-edition-install"),mapOf("https://fixture.invalid/core.db" to SliceFixtures.core,"https://fixture.invalid/reference.db" to ReferenceFixture.file))
        var core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        assertEquals(edition,core.moduleOffers().single().definitionEditionTarget)
        assertIs<NativeDefinitionEditionResolution.Download>(core.resolveDefinitionEdition(edition))
        assertIs<NativeDefinitionEditionResolution.Unavailable>(core.resolveDefinitionEdition(edition.copy(moduleVersion="2026.9.27")))
        assertFailsWith<IllegalStateException> { core.searchDefinitions(edition,"term") }
        val installed=assertIs<NativeDefinitionEditionResolution.Installed>(core.installDefinitionEdition(edition))
        assertEquals(1,installed.status.entries)
        assertTrue(core.navigation.value.readers.isEmpty())
        val card=assertIs<NativeDefinitionResolution.Readable>(core.resolveDefinition(ReferenceFixture.target())).card
        assertEquals(listOf(card.copy(match="name")),core.searchDefinitions(edition,card.title))
        assertTrue(core.searchDefinitions(edition,card.title,0).isEmpty())
        core.close();io.offline=true
        core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        assertIs<NativeDefinitionEditionResolution.Installed>(core.resolveDefinitionEdition(edition))
        assertEquals(listOf(card.copy(match="name")),core.searchDefinitions(edition,card.title))
        assertTrue(core.navigation.value.readers.isEmpty());core.close()
    }

    @Test
    fun exactDefinitionDownloadVerifiedInstallPagedSourceAndMixedTrailRestoreOffline(): Unit = runBlocking {
        val catalog=ReferenceFixture.catalog();val target=ReferenceFixture.target()
        val io=FixtureIO(SliceFixtures.root("definition-install"),mapOf("https://fixture.invalid/core.db" to SliceFixtures.core,"https://fixture.invalid/reference.db" to ReferenceFixture.file))
        var core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        assertTrue(core.lookupIdentities("и").isEmpty())
        val source=NativeSearchDatabase(SliceFixtures.core.path)
        val document=try { source.open();source.readSourceDocument(source.listSearchDocuments().first().id)!! } finally { source.close() }
        assertIs<NativeDocumentResolution.Readable>(core.openDocument(document.target.copy(anchor=document.sections.first().chunks.first().anchor)))
        assertIs<NativeDefinitionResolution.Unavailable>(core.resolveDefinition(target.copy(moduleVersion="2026.9.27")))
        assertIs<NativeDefinitionResolution.Download>(core.openDefinition(target))
        assertFailsWith<IllegalStateException> { core.installDefinition(target.copy(entityId="reference.entity.missing")) }
        assertEquals(target.copy(entityId="reference.entity.missing"),core.installFailure.value!!.target)
        assertIs<NativeDefinitionResolution.Readable>(core.installDefinition(target))
        val page=core.definitionBlocks(target)
        assertEquals(8,page.blocks.size);assertNotNull(page.next)
        val text=assertNotNull(core.definitionText(target,page.blocks.first().chunkId))
        assertEquals("requires-review",assertNotNull(core.definitionSource(target,text.sourceId)).reviewStatus)
        core.saveReaderSnapshot(NativeReaderRoute.Definition(target,page.blocks.first().linkId,0,2,19))
        val original=core.navigation.value
        core.close();io.offline=true
        core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        assertEquals(original,core.navigation.value)
        assertIs<NativeDefinitionResolution.Readable>(assertIs<NativeReaderResolution.Definition>(core.restoreReader()).resolution)
        assertEquals(SliceFixtures.textDigest(text.text),SliceFixtures.textDigest(core.definitionText(target,page.blocks.first().chunkId)!!.text))
        core.back();core.saveReaderSnapshot(NativeReaderRoute.Definition(target,firstVisibleItemIndex=9))
        assertEquals(1,core.navigation.value.readers.size)
        assertIs<NativeDocumentResolution.Readable>(assertIs<NativeReaderResolution.Document>(core.restoreReader()).resolution)
        core.back();assertTrue(core.navigation.value.readers.isEmpty());core.close()
    }
    @Test
    fun verifiedBytesOfAnotherEditionCannotActivateUnderRequestedReferenceEdition(): Unit = runBlocking {
        val original=contentJson.parseToJsonElement(ReferenceFixture.catalog()).jsonObject
        val module=(original["modules"] as JsonArray).single().jsonObject
        val capability=module["definitionReference"]!!.jsonObject
        val wrong=JsonObject(module+("definitionReference" to JsonObject(capability+("editionId" to JsonPrimitive("minimed.definition.reference.2026.9.27")))))
        val catalog=JsonObject(original+("modules" to JsonArray(listOf(wrong)))).toString()
        val target=ReferenceFixture.target().copy(editionId="minimed.definition.reference.2026.9.27")
        val io=FixtureIO(SliceFixtures.root("definition-wrong-edition"),mapOf("https://fixture.invalid/core.db" to SliceFixtures.core,"https://fixture.invalid/reference.db" to ReferenceFixture.file))
        val core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        assertIs<NativeDefinitionResolution.Download>(core.openDefinition(target))
        assertFailsWith<IllegalStateException> { core.installDefinitionEdition(target.editionTarget()) }
        assertIs<NativeDefinitionResolution.Download>(core.resolveDefinition(target))
        assertIs<NativeDefinitionEditionResolution.Download>(core.resolveDefinitionEdition(target.editionTarget()))
        assertEquals(target.editionTarget(),core.installFailure.value!!.target)
        assertTrue(File(io.root,"content").listFiles()!!.none { it.name==SliceFixtures.digest(ReferenceFixture.file).removePrefix("sha256:")+".db" })
        core.close()
    }

}
