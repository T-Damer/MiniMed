package dev.localmed.nativespike.shared.core

import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import dev.localmed.nativespike.shared.content.JVMContentIO
import dev.localmed.nativespike.shared.content.NativeArtifact
import dev.localmed.nativespike.shared.content.NativeCatalog
import dev.localmed.nativespike.shared.content.NativeContentInstaller
import dev.localmed.nativespike.shared.content.bundledNativeCatalog
import dev.localmed.nativespike.shared.content.contentJson
import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import java.io.File
import java.security.MessageDigest
import java.util.zip.GZIPOutputStream
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

internal object SliceFixtures {
    val repository=File(System.getProperty("NATIVE_SLICE_ROOT")).canonicalFile
    val directory=File(repository,"playwright/native-core-fixtures").also { it.mkdirs() }
    val core=File(directory,"core.db")
    val module=File(repository,"apps/app/public/content/modules/minimed-regulatory-pediatrics-0.3.4-preview.1.db")
    init {
        val prepared=File(directory,"prepared").also { it.mkdirs() }
        // Rebuild fixture authoring inputs so an older fixture file cannot remain in the corpus.
        prepared.listFiles()?.forEach { it.delete() }
        for((source,target) in listOf("order-127n-tuberculosis-observation-groups.md" to "order-127n.md","manifest.yaml" to "manifest.yaml","aliases.yaml" to "aliases.yaml")) File(repository,"content/regulatory-rf-pilot/$source").copyTo(File(prepared,target),overwrite=true)
        // A source-built tiny core is a separate pack; installed packs cannot share active IDs.
        File(prepared,"manifest.yaml").let { it.writeText(it.readText().replace("id: minimed.rf-regulatory-pilot","id: minimed.test.core.ru")) }
        val process=ProcessBuilder("uv","run","--project","tools/ingest","medbase","build","--input",prepared.path,"--output",core.path,"--report",File(directory,"build-report.json").path)
        process.directory(repository);process.environment().clear();process.environment().putAll(mapOf("HOME" to System.getProperty("user.home"),"PATH" to "/Users/d/.bun/bin:/Users/d/.local/bin:/opt/homebrew/bin:/usr/bin:/bin","TMPDIR" to "/tmp","LANG" to "en_US.UTF-8"))
        process.redirectErrorStream(true);process.redirectOutput(File(directory,"build.log"));check(process.start().waitFor()==0) { "Source fixture builder failed; see playwright/native-core-fixtures/build.log" }
    }
    fun textDigest(value: String): String=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) }
    fun digest(file: File): String="sha256:"+MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString("") { "%02x".format(it.toInt() and 255) }
    fun artifact(file: File,url: String="https://fixture.invalid/core.db")=NativeArtifact(file.name,url,digest(file),file.length())
    fun root(name: String): File=File(directory,"test-$name").also { it.deleteRecursively();it.mkdirs() }
    suspend fun catalog(moduleArtifact: NativeArtifact=artifact(module,"https://fixture.invalid/module.db"),wrongSource: Boolean=false): String {
        val catalog=contentJson.parseToJsonElement(bundledNativeCatalog()).jsonObject
        val original=(catalog["modules"] as JsonArray).single { it.jsonObject["id"]==JsonPrimitive("minimed.regulatory.pediatrics.ru") }.jsonObject
        val artifact=original["artifacts"]!!.let { it as JsonArray }.single().jsonObject
        val projected=JsonObject(artifact+mapOf("url" to JsonPrimitive(moduleArtifact.url),"sha256" to JsonPrimitive(moduleArtifact.sha256),"sizeBytes" to JsonPrimitive(moduleArtifact.sizeBytes),"compression" to JsonPrimitive(moduleArtifact.compression),"decodedSha256" to JsonPrimitive(moduleArtifact.decodedSha256),"decodedSizeBytes" to JsonPrimitive(moduleArtifact.decodedSizeBytes)))
        var m=JsonObject(original+("artifacts" to JsonArray(listOf(projected))))
        if(wrongSource) {
            val table=m["documentTable"]!!.jsonObject
            val rows=(table["rows"] as JsonArray).map { value ->
                val row=value as JsonArray
                if(row[0]==JsonPrimitive("regulatory.rf.minzdrav.302n-2019")) JsonArray(row.mapIndexed { i,v -> if(i==2) JsonPrimitive("0".repeat(64)) else v }) else row
            }
            m=JsonObject(m+("documentTable" to JsonObject(table+("rows" to JsonArray(rows)))))
        }
        return JsonObject(catalog+("modules" to JsonArray(listOf(m)))).toString()
    }
    suspend fun pointerSlice(): Triple<File,File,String> {
        val prepared=File(directory,"pointer-prepared").also { it.mkdirs() }
        File(repository,"data/build/core-reference-pointers/minimed.core.reference.ru/core.catalog.pointer.reference.rls.mkb.node.a00-1be5df98ad942132.md").copyTo(File(prepared,"pointer.md"),overwrite=true)
        File(repository,"data/build/core-reference-pointers/minimed.core.reference.ru/manifest.yaml").copyTo(File(prepared,"manifest.yaml"),overwrite=true)
        File(prepared,"aliases.yaml").writeText("aliases: []\n")
        val pointerCore=File(directory,"pointer-core.db")
        fun execute(arguments: List<String>,log: String) {
            val process=ProcessBuilder(arguments).directory(repository)
            process.environment().clear();process.environment().putAll(mapOf("HOME" to System.getProperty("user.home"),"PATH" to "/Users/d/.bun/bin:/Users/d/.local/bin:/opt/homebrew/bin:/usr/bin:/bin","TMPDIR" to "/tmp","LANG" to "en_US.UTF-8"))
            process.redirectErrorStream(true);process.redirectOutput(File(directory,log));check(process.start().waitFor()==0) { "Pointer fixture failed; see playwright/native-core-fixtures/$log" }
        }
        execute(listOf("uv","run","--project","tools/ingest","medbase","build","--input",prepared.path,"--output",pointerCore.path,"--report",File(directory,"pointer-build-report.json").path),"pointer-build.log")
        val source=File(directory,"pointer-source.db");source.delete()
        val script="""
            import sqlite3,json,hashlib,sys
            from localmed_ingest.sqlite_builder import schema_sql,rebuild_chunks_fts_index
            original=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
            subset=sqlite3.connect(sys.argv[2]);subset.executescript(schema_sql())
            subset.execute('PRAGMA defer_foreign_keys=ON')
            document='rls.mkb.node.a00';version='rls.mkb.node.a00@rls-8814b08900b0'
            for table,clause,args in [('content_packs','',()),('documents',' WHERE id=?',(document,)),('document_versions',' WHERE id=?',(version,)),('sections',' WHERE document_version_id=?',(version,)),('chunks',' WHERE document_version_id=?',(version,))]:
                columns=[r[1] for r in subset.execute('PRAGMA table_info('+table+')')]
                fields=','.join(columns)
                rows=original.execute('SELECT '+fields+' FROM '+table+clause,args).fetchall()
                subset.executemany('INSERT INTO '+table+'('+fields+') VALUES('+','.join('?' for _ in columns)+')',rows)
                assert rows==subset.execute('SELECT '+fields+' FROM '+table+clause,args).fetchall()
            rebuild_chunks_fts_index(subset);subset.commit()
            assert not subset.execute('PRAGMA foreign_key_check').fetchall()
            assert subset.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
            rows=[{'documentId':r[0],'documentVersionId':r[1],'sourceChecksum':r[2]} for r in subset.execute('SELECT document_id,id,source_checksum FROM document_versions ORDER BY document_id,id')]
            digest='sha256:'+hashlib.sha256(json.dumps(rows,ensure_ascii=False,separators=(',',':'),sort_keys=True).encode()).hexdigest()
            open(sys.argv[3],'w').write(digest)
        """.trimIndent()
        val digestFile=File(directory,"pointer-source-digest.txt")
        execute(listOf("uv","run","--project","tools/ingest","python","-c",script,File(repository,"data/build/rls-mkb-module/minimed.mkb.ru.db").path,source.path,digestFile.path),"pointer-source.log")
        val root=contentJson.parseToJsonElement(bundledNativeCatalog()).jsonObject
        val original=(root["modules"] as JsonArray).single { it.jsonObject["id"]==JsonPrimitive("minimed.mkb.ru") }.jsonObject
        val index=(original["artifacts"] as JsonArray).single().jsonObject
        val artifact=artifact(source,"https://fixture.invalid/pointer-source.db")
        val digest=digestFile.readText()
        val projected=JsonObject(index+mapOf("url" to JsonPrimitive(artifact.url),"sha256" to JsonPrimitive(artifact.sha256),"sizeBytes" to JsonPrimitive(artifact.sizeBytes),"compression" to JsonPrimitive("none"),"sourceSetDigest" to JsonPrimitive(digest)))
        val table=original["documentTable"]!!.jsonObject
        val rows=(table["rows"] as JsonArray).filter { (it as JsonArray)[0]==JsonPrimitive("rls.mkb.node.a00") }
        val module=JsonObject(original+mapOf("sourceSetDigest" to JsonPrimitive(digest),"artifacts" to JsonArray(listOf(projected)),"documentTable" to JsonObject(table+("rows" to JsonArray(rows)))))
        return Triple(pointerCore,source,JsonObject(root+("modules" to JsonArray(listOf(module)))).toString())
    }
    suspend fun target(catalog: String): NativeDocumentTarget {
        val m=NativeCatalog.parse(catalog).modules.single()
        val db=NativeSearchDatabase(module.path)
        try { db.open();val d=db.readSourceDocument("regulatory.rf.minzdrav.302n-2019")!!;return m.members.single { it.documentId==d.target.documentId }.target(m,d.sections.first().chunks.first().anchor) } finally { db.close() }
    }
}

internal class FixtureIO(val root: File,private val files: Map<String,File>): NativeContentIO by JVMContentIO(root.path) {
    var downloads=0
    var offline=false
    var blockStateWrite=false
    val writeStarted=CompletableDeferred<Unit>()
    val writeRelease=CompletableDeferred<Unit>()
    override suspend fun writeTextAtomic(path: String,text: String) {
        JVMContentIO(root.path).writeTextAtomic(path,text)
        if(blockStateWrite) { blockStateWrite=false;writeStarted.complete(Unit);writeRelease.await() }
    }
    var started: CompletableDeferred<Unit>?=null
    var release: CompletableDeferred<Unit>?=null
    override suspend fun download(url: String,path: String,maximumBytes: Long,progress: (Long)->Unit) {
        check(!offline) { "Network disabled" };downloads++
        started?.complete(Unit);release?.await();currentCoroutineContext().ensureActive()
        val source=files[url] ?: error("Unknown fixture asset");require(source.length()<=maximumBytes)
        val destination=File(root,path);destination.parentFile!!.mkdirs();source.copyTo(destination,overwrite=true);progress(source.length())
    }
}

class NativeCoreSliceTest {
    @Test
    fun realSourceInstallExactAnchorStateReloadOfflineAndBack(): Unit = runBlocking {
        val catalog=SliceFixtures.catalog();val target=SliceFixtures.target(catalog);val io=FixtureIO(SliceFixtures.root("reload"),mapOf("https://fixture.invalid/core.db" to SliceFixtures.core,"https://fixture.invalid/module.db" to SliceFixtures.module))
        var core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        core.awaitReady()
        assertIs<NativeDocumentResolution.Download>(core.openDocument(target))
        core.saveSearchSnapshot(NativeSearchSnapshot("приказ 302н",4,12))
        val read=assertIs<NativeDocumentResolution.Readable>(core.install(target)).document
        assertEquals(target,read.target)
        assertTrue(read.sections.flatMap { it.chunks }.any { it.anchor==target.anchor })
        val source=NativeSearchDatabase(SliceFixtures.module.path)
        try { source.open();assertEquals(SliceFixtures.textDigest(source.readSourceDocument(target.documentId)!!.sections.toString()),SliceFixtures.textDigest(read.sections.toString())) } finally { source.close() }
        val chunk=read.sections.first().chunks.first()
        core.saveReaderSnapshot(NativeReaderRoute.Document(target,chunk.id,17));core.close();core.close()
        io.offline=true
        core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        assertIs<NativeDocumentResolution.Readable>(assertIs<NativeReaderResolution.Document>(core.restoreReader()).resolution)
        assertEquals(17,assertIs<NativeReaderRoute.Document>(core.navigation.value.readers.single()).offsetPx)
        assertEquals(NativeSearchSnapshot("приказ 302н",4,12),core.navigation.value.search)
        core.back();core.saveReaderSnapshot(NativeReaderRoute.Document(target,chunk.id,99))
        assertTrue(core.navigation.value.readers.isEmpty());assertEquals(2,io.downloads)
        core.close()
    }

    @Test
    fun wrongMembershipAndMissingAnchorNeverOpenOtherSource(): Unit = runBlocking {
        val catalog=SliceFixtures.catalog(wrongSource=true);val target=SliceFixtures.target(catalog);val io=FixtureIO(SliceFixtures.root("wrong-source"),mapOf("https://fixture.invalid/core.db" to SliceFixtures.core,"https://fixture.invalid/module.db" to SliceFixtures.module))
        val core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        assertIs<NativeDocumentResolution.Download>(core.openDocument(target))
        assertFailsWith<IllegalStateException> { core.install(target) }
        assertIs<NativeDocumentResolution.Download>(assertIs<NativeReaderResolution.Document>(core.restoreReader()).resolution)
        assertEquals(target,core.installFailure.value?.target)
        assertIs<NativeDocumentResolution.Unavailable>(core.resolveDocument(target.documentId,expectedTarget=target.copy(documentVersionId="other-edition")))
        core.close()
        val valid=SliceFixtures.catalog();val other=FixtureIO(SliceFixtures.root("missing-anchor"),mapOf("https://fixture.invalid/core.db" to SliceFixtures.core,"https://fixture.invalid/module.db" to SliceFixtures.module))
        val second=NativeMedicalCore.openWithArtifact(other,valid,SliceFixtures.artifact(SliceFixtures.core))
        val absent=SliceFixtures.target(valid).copy(anchor="absent-source-anchor")
        assertFailsWith<IllegalStateException> { second.install(absent) }
        assertFalse(other.exists("native-content-state.json"));second.close()
    }

    @Test
    fun backDuringInstallAndCancelledDownloadCannotRestoreStaleReader(): Unit = runBlocking {
        val catalog=SliceFixtures.catalog();val target=SliceFixtures.target(catalog);val io=FixtureIO(SliceFixtures.root("cancellation"),mapOf("https://fixture.invalid/core.db" to SliceFixtures.core,"https://fixture.invalid/module.db" to SliceFixtures.module))
        val core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        core.openDocument(target);io.started=CompletableDeferred();io.release=CompletableDeferred()
        val install=async { core.install(target) };io.started!!.await();core.back();io.release!!.complete(Unit)
        assertIs<NativeDocumentResolution.Readable>(install.await());assertTrue(core.navigation.value.readers.isEmpty())
        core.close()
        val secondIO=FixtureIO(SliceFixtures.root("cancel-no-commit"),mapOf("https://fixture.invalid/core.db" to SliceFixtures.core,"https://fixture.invalid/module.db" to SliceFixtures.module))
        val second=NativeMedicalCore.openWithArtifact(secondIO,catalog,SliceFixtures.artifact(SliceFixtures.core))
        secondIO.started=CompletableDeferred();secondIO.release=CompletableDeferred()
        val cancelled=async { second.install(target) };secondIO.started!!.await();cancelled.cancelAndJoin()
        assertIs<NativeDocumentResolution.Download>(second.resolveDocument(target.documentId,expectedTarget=target))
        assertFalse(secondIO.exists("native-content-state.json"));assertEquals(null,second.installProgress.value);second.close()
    }

    @Test
    fun gzipChecksBothIdentitiesAndCorruptCacheRetriesWithoutChangingSource(): Unit = runBlocking {
        val gzip=File(SliceFixtures.directory,"core.db.gz")
        GZIPOutputStream(gzip.outputStream()).use { it.write(SliceFixtures.core.readBytes()) }
        val artifact=NativeArtifact("core-gzip","https://fixture.invalid/core.gz",SliceFixtures.digest(gzip),gzip.length(),"gzip",SliceFixtures.digest(SliceFixtures.core),SliceFixtures.core.length())
        val root=SliceFixtures.root("gzip");val io=FixtureIO(root,mapOf(artifact.url to gzip))
        val path="content/${artifact.decodedSha256.removePrefix("sha256:")}.db"
        File(root,path).also { it.parentFile!!.mkdirs();it.writeText("invalid generated cache") }
        val catalog=SliceFixtures.catalog()
        val core=NativeMedicalCore.openWithArtifact(io,catalog,artifact);core.awaitReady();core.close();assertEquals(1,io.downloads)
        val bad=artifact.copy(decodedSha256="sha256:"+"0".repeat(64))
        val badIO=FixtureIO(SliceFixtures.root("wrong-decoded"),mapOf(artifact.url to gzip))
        assertFailsWith<NativeContentVerificationException> { NativeMedicalCore.openWithArtifact(badIO,catalog,bad) }
        assertFalse(badIO.exists("content/${bad.decodedSha256.removePrefix("sha256:")}.db"))
        val archiveBad=artifact.copy(sha256="sha256:"+"1".repeat(64))
        assertFailsWith<NativeContentVerificationException> { NativeMedicalCore.openWithArtifact(FixtureIO(SliceFixtures.root("wrong-archive"),mapOf(artifact.url to gzip)),catalog,archiveBad) }
    }

    @Test
    fun foreignKeyViolationRejectedBeforeActivation(): Unit = runBlocking {
        val corrupt=File(SliceFixtures.directory,"foreign-key-invalid.db");corrupt.delete()
        BundledSQLiteDriver().open(corrupt.path).use { db ->
            for(sql in listOf("CREATE TABLE chunks_fts (chunk_id TEXT)","CREATE TABLE content_packs(schema_version INTEGER)","INSERT INTO content_packs VALUES(2)","CREATE TABLE parent(id TEXT PRIMARY KEY)","CREATE TABLE child(parent_id TEXT REFERENCES parent(id))","INSERT INTO child VALUES('missing')")) db.prepare(sql).use { it.step() }
        }
        val artifact=SliceFixtures.artifact(corrupt,"https://fixture.invalid/bad.db")
        val io=FixtureIO(SliceFixtures.root("bad-fk"),mapOf(artifact.url to corrupt))
        assertFailsWith<IllegalStateException> { NativeMedicalCore.openWithArtifact(io,SliceFixtures.catalog(),artifact) }
        assertFalse(io.exists("content/${artifact.decodedSha256.removePrefix("sha256:")}.db"))
    }

    @Test
    fun lateDifferentSourceFileRestoresExactDownloadOffer() : Unit = runBlocking {
        val catalog=SliceFixtures.catalog();val target=SliceFixtures.target(catalog)
        val io=FixtureIO(SliceFixtures.root("late-edition"),mapOf("https://fixture.invalid/core.db" to SliceFixtures.core,"https://fixture.invalid/module.db" to SliceFixtures.module))
        var core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        assertIs<NativeDocumentResolution.Readable>(core.install(target));core.openDocument(target);core.close()
        val installed=File(io.root,"content/${SliceFixtures.digest(SliceFixtures.module).removePrefix("sha256:")}.db")
        SliceFixtures.core.copyTo(installed,overwrite=true)
        core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        assertIs<NativeDocumentResolution.Download>(assertIs<NativeReaderResolution.Document>(core.restoreReader()).resolution)
        assertIs<NativeDocumentResolution.Readable>(core.install(target))
        assertEquals(target,core.navigation.value.readers.single().target)
        core.close()
    }

    @Test
    fun cancelledActivationRestoresPreviousRegistryAndRemovesUnregisteredBytes(): Unit = runBlocking {
        val catalog=SliceFixtures.catalog();val target=SliceFixtures.target(catalog)
        val io=FixtureIO(SliceFixtures.root("cancel-activation"),mapOf("https://fixture.invalid/core.db" to SliceFixtures.core,"https://fixture.invalid/module.db" to SliceFixtures.module))
        val core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        core.saveSearchSnapshot(NativeSearchSnapshot("192н",2,4))
        val before=io.readText("native-content-state.json")
        io.blockStateWrite=true
        val installation=async { core.install(target) };io.writeStarted.await();installation.cancelAndJoin()
        assertEquals(before,io.readText("native-content-state.json"))
        assertEquals(NativeSearchSnapshot("192н",2,4),core.navigation.value.search)
        assertFalse(io.exists("content/${SliceFixtures.digest(SliceFixtures.module).removePrefix("sha256:")}.db"))
        assertIs<NativeDocumentResolution.Download>(core.resolveDocument(target.documentId,expectedTarget=target));core.close()
    }

    @Test
    fun closeCancelsBlockedDownloadBeforeClosingDatabase(): Unit = runBlocking {
        val catalog=SliceFixtures.catalog();val target=SliceFixtures.target(catalog)
        val io=FixtureIO(SliceFixtures.root("close-download"),mapOf("https://fixture.invalid/core.db" to SliceFixtures.core,"https://fixture.invalid/module.db" to SliceFixtures.module))
        val core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        io.started=CompletableDeferred();io.release=CompletableDeferred()
        val installation=async { core.install(target) };io.started!!.await()
        kotlinx.coroutines.withTimeout(2000) { listOf(async { core.close() },async { core.close() }).awaitAll() }
        installation.join();assertTrue(installation.isCancelled)
        assertFalse(io.exists("native-content-state.json"))
        assertEquals(null,core.installProgress.value)
        assertTrue(File(io.root,"staging").listFiles().orEmpty().isEmpty())
    }

    @Test
    fun failedWarmupCompletesReadinessExceptionallyAndCloses() : Unit = runBlocking {
        val invalid=File(SliceFixtures.directory,"warmup-invalid.db");invalid.delete()
        BundledSQLiteDriver().open(invalid.path).use { db -> db.prepare("CREATE TABLE chunks_fts(chunk_id TEXT)").use { it.step() } }
        val database=NativeSearchDatabase(invalid.path);database.open()
        val engine=dev.localmed.nativespike.shared.search.LookupEngine(database)
        try {
            val failure=assertFailsWith<Exception> { kotlinx.coroutines.withTimeout(2000) { engine.awaitReady() } }
            assertFalse(failure is kotlinx.coroutines.TimeoutCancellationException)
        } finally { engine.close();database.close() }
    }

    @Test
    fun concurrentReadsLookupAndCloseUseOneDatabaseGate(): Unit = runBlocking {
        val io=FixtureIO(SliceFixtures.root("database-gate"),mapOf("https://fixture.invalid/core.db" to SliceFixtures.core))
        val core=NativeMedicalCore.openWithArtifact(io,SliceFixtures.catalog(),SliceFixtures.artifact(SliceFixtures.core))
        (0 until 12).map { i -> async { if(i%2==0) core.search("127н") else assertIs<NativeDocumentResolution.Readable>(core.resolveDocument("regulatory.rf.minzdrav.127n-2019-tuberculosis")) } }.awaitAll()
        core.close();assertFailsWith<IllegalStateException> { core.search("192н") }
    }
    @Test
    fun catalogExactEditionRouteReloadBackAndStaleScrollPreserveSearch(): Unit = runBlocking {
        val catalog=SliceFixtures.catalog()
        val io=FixtureIO(SliceFixtures.root("catalog-route"),mapOf("https://fixture.invalid/core.db" to SliceFixtures.core))
        var core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        val offer=core.moduleOffers().single()
        val documents=core.moduleDocuments(offer.id,offer.version)
        assertEquals(3,documents.size)
        assertTrue(documents.all { it.target.moduleId==offer.id && it.target.moduleVersion==offer.version })
        assertFailsWith<IllegalArgumentException> { core.moduleDocuments(offer.id,"different-edition") }
        core.saveSearchSnapshot(NativeSearchSnapshot("192н",2,8))
        core.openCatalog();core.openCatalog(offer.id,offer.version)
        val snapshot=NativeCatalogSnapshot(offer.id,offer.version,1,13)
        core.saveCatalogSnapshot(snapshot)
        assertIs<NativeDocumentResolution.Download>(core.openDocument(documents.single { it.target.documentId=="regulatory.rf.minzdrav.302n-2019" }.target))
        core.saveCatalogSnapshot(snapshot.copy(firstVisibleItemOffset=999))
        assertEquals(snapshot,core.navigation.value.catalog)
        core.close();io.offline=true
        core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(SliceFixtures.core))
        assertEquals(snapshot,core.navigation.value.catalog)
        core.back();assertEquals(snapshot,core.navigation.value.catalog)
        core.back();assertEquals(NativeCatalogSnapshot(),core.navigation.value.catalog)
        core.saveCatalogSnapshot(snapshot);assertEquals(NativeCatalogSnapshot(),core.navigation.value.catalog)
        core.back();assertEquals(null,core.navigation.value.catalog)
        core.saveCatalogSnapshot(NativeCatalogSnapshot());assertEquals(null,core.navigation.value.catalog)
        assertEquals(NativeSearchSnapshot("192н",2,8),core.navigation.value.search)
        core.openCatalog();core.showSearch();assertEquals(null,core.navigation.value.catalog)
        core.close()
    }

    @Test
    fun actualRlsDiscoveryAnchorOpensExactOriginalWithoutInventedExcerpt(): Unit = runBlocking {
        val (pointerCore,source,catalog)=SliceFixtures.pointerSlice()
        val pointerId="core.catalog.pointer.reference.rls.mkb.node.a00-1be5df98ad942132"
        val pointerDb=NativeSearchDatabase(pointerCore.path)
        val pointer=try { pointerDb.open();pointerDb.readSourceDocument(pointerId)!! } finally { pointerDb.close() }
        val syntheticAnchor=pointer.sections.single { it.title=="Классификационный контекст" }.chunks.first().anchor
        val io=FixtureIO(SliceFixtures.root("pointer-anchor"),mapOf("https://fixture.invalid/core.db" to pointerCore,"https://fixture.invalid/pointer-source.db" to source))
        val core=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(pointerCore))
        val offer=assertIs<NativeDocumentResolution.Download>(core.resolveDocument(pointerId,syntheticAnchor))
        assertEquals("rls.mkb.node.a00",offer.target.documentId)
        assertEquals("rls.mkb.node.a00@rls-8814b08900b0",offer.target.documentVersionId)
        assertEquals(null,offer.target.anchor)
        val original=assertIs<NativeDocumentResolution.Readable>(core.install(offer.target)).document
        val exact=original.sections.first().chunks.first().anchor
        assertIs<NativeDocumentResolution.Readable>(core.resolveDocument(pointerId,syntheticAnchor))
        val excerpt=assertIs<NativeDocumentResolution.Readable>(core.resolveDocument(original.target.documentId,expectedTarget=original.target.copy(anchor=exact))).document
        assertEquals(exact,excerpt.target.anchor)
        val metadata=contentJson.parseToJsonElement(pointer.metadataJson).jsonObject
        val canonical=JsonObject(metadata+mapOf("definitionPreviewAnchor" to JsonPrimitive(syntheticAnchor),"canonicalDefinition" to JsonObject(mapOf("sourceAnchor" to JsonPrimitive(exact)))))
        assertEquals(exact,core.pointerAnchor(pointer,canonical,syntheticAnchor,offer.target))
        val mention=JsonObject(metadata+("terminologyMentionAnchors" to JsonObject(mapOf(syntheticAnchor to JsonPrimitive(exact)))))
        assertEquals(exact,core.pointerAnchor(pointer,mention,syntheticAnchor,offer.target))
        val wrongProvenance=JsonObject(metadata+("sourceChecksum" to JsonPrimitive("sha256:"+"0".repeat(64))))
        assertEquals(syntheticAnchor,core.pointerAnchor(pointer,wrongProvenance,syntheticAnchor,offer.target))
        val terminology=JsonObject(metadata+("pointerKind" to JsonPrimitive("terminology")))
        assertEquals("foreign-version/unknown#chunk",core.pointerAnchor(pointer,terminology,"foreign-version/unknown#chunk",offer.target))
        assertIs<NativeDocumentResolution.Unavailable>(core.resolveDocument(pointerId,"foreign-version/unknown#chunk"))
        core.close();io.offline=true
        val restored=NativeMedicalCore.openWithArtifact(io,catalog,SliceFixtures.artifact(pointerCore))
        assertIs<NativeDocumentResolution.Readable>(restored.resolveDocument(pointerId,syntheticAnchor));restored.close()
    }

}
