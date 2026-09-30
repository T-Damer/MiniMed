package dev.localmed.nativespike.shared.core

import dev.localmed.nativespike.shared.content.NativeArtifact
import dev.localmed.nativespike.shared.content.NativeCatalog
import dev.localmed.nativespike.shared.content.NativeContentInstaller
import dev.localmed.nativespike.shared.content.NativeModule
import dev.localmed.nativespike.shared.content.contentJson
import dev.localmed.nativespike.shared.content.optionalString
import dev.localmed.nativespike.shared.content.validateTarget
import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.model.SearchOutcome
import dev.localmed.nativespike.shared.search.LookupEngine
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.updateAndGet
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

@Serializable
internal data class NativeInstalledModule(val moduleId: String, val moduleVersion: String, val sourceSetDigest: String, val artifact: NativeArtifact, val path: String)
@Serializable
internal data class NativeContentState(val schemaVersion: Int, val installed: List<NativeInstalledModule> = emptyList(), val navigation: NativeNavigationSnapshot = NativeNavigationSnapshot())

/** UI-independent owner of lookup, source reads and private content lifecycle. */
class NativeMedicalCore private constructor(
    private val io: NativeContentIO,
    private val catalog: NativeCatalog,
    private val database: NativeSearchDatabase,
    private var persisted: NativeContentState,
) {
    private val databaseGate=Mutex()
    private val stateGate=Mutex()
    private val installGate=Mutex()
    private val closed=MutableStateFlow(false)
    private val closeFinished=CompletableDeferred<Unit>()
    private val generation=MutableStateFlow(0L)
    private var activeInstall: Job? = null
    private val engine=LookupEngine(database,databaseGate)
    private val mounted=mutableMapOf<String,NativeSearchDatabase>()
    private val installer=NativeContentInstaller(io)
    private val navigationState=MutableStateFlow(persisted.navigation)
    private val progressState=MutableStateFlow<NativeInstallProgress?>(null)
    private val failureState=MutableStateFlow<NativeInstallFailure?>(null)
    val navigation: StateFlow<NativeNavigationSnapshot> = navigationState.asStateFlow()
    val installProgress: StateFlow<NativeInstallProgress?> = progressState.asStateFlow()
    val installFailure: StateFlow<NativeInstallFailure?> = failureState.asStateFlow()
    val vocabularyBuildMs: Double get()=engine.vocabularyBuildMs
    val indexBuildMs: Double get()=engine.indexBuildMs
    private fun requireOpen() { check(!closed.value) { "Native core is closed" } }
    suspend fun awaitReady() { requireOpen();engine.awaitReady() }
    suspend fun search(query: String,onStage: ((String,Double)->Unit)?=null): SearchOutcome? {
        requireOpen();require(query.length<=NATIVE_SEARCH_QUERY_MAX_LENGTH && !query.contains('\u0000')) { "Invalid search query size" };return withContext(Dispatchers.Default) { engine.search(query,onStage) }
    }

    suspend fun moduleOffers(): List<NativeModuleOffer> = withContext(Dispatchers.Default) {
        requireOpen();catalog.modules.map { it.offer() }
    }
    suspend fun moduleDocuments(moduleId: String, moduleVersion: String): List<NativeCatalogDocument> = withContext(Dispatchers.Default) {
        requireOpen();catalogModule(moduleId, moduleVersion).documents()
    }
    private fun catalogModule(moduleId: String, moduleVersion: String): NativeModule =
        catalog.modules.singleOrNull { it.id == moduleId && it.version == moduleVersion }
            ?: throw IllegalArgumentException("Exact catalog edition is absent")
    private fun validateCatalogSnapshot(snapshot: NativeCatalogSnapshot) {
        require((snapshot.moduleId == null) == (snapshot.moduleVersion == null)) { "Incomplete catalog route" }
        require(snapshot.firstVisibleItemIndex >= 0 && snapshot.firstVisibleItemOffset >= 0 && snapshot.overviewFirstVisibleItemIndex >= 0 && snapshot.overviewFirstVisibleItemOffset >= 0)
        require(listOf(snapshot.filterQuery,snapshot.overviewFilterQuery).all { it.length <= NATIVE_CATALOG_FILTER_MAX_LENGTH && !it.contains('\u0000') })
        if (snapshot.moduleId != null) catalogModule(snapshot.moduleId, snapshot.moduleVersion!!)
    }
    suspend fun openCatalog(moduleId: String? = null, moduleVersion: String? = null) {
        require((moduleId == null) == (moduleVersion == null)) { "Incomplete catalog route" }
        stateGate.withLock {
            requireOpen()
            val current=persisted.navigation.catalog
            val overview=when {
                current == null -> null
                current.moduleId == null -> current
                else -> NativeCatalogSnapshot(filterQuery=current.overviewFilterQuery,firstVisibleItemIndex=current.overviewFirstVisibleItemIndex,firstVisibleItemOffset=current.overviewFirstVisibleItemOffset)
            }
            val snapshot=if(moduleId == null) overview ?: NativeCatalogSnapshot() else NativeCatalogSnapshot(moduleId,moduleVersion,
                overviewFilterQuery=overview?.filterQuery ?: "",overviewFirstVisibleItemIndex=overview?.firstVisibleItemIndex ?: 0,overviewFirstVisibleItemOffset=overview?.firstVisibleItemOffset ?: 0)
            validateCatalogSnapshot(snapshot)
            commit(persisted.copy(navigation = persisted.navigation.copy(catalog = snapshot, readers = emptyList())))
        }
    }
    suspend fun saveCatalogSnapshot(snapshot: NativeCatalogSnapshot) {
        validateCatalogSnapshot(snapshot)
        stateGate.withLock {
            requireOpen()
            val current = persisted.navigation.catalog ?: return@withLock
            if (current.moduleId != snapshot.moduleId || current.moduleVersion != snapshot.moduleVersion || persisted.navigation.readers.isNotEmpty()) return@withLock
            commit(persisted.copy(navigation = persisted.navigation.copy(catalog = snapshot)))
        }
    }
    suspend fun showSearch() {
        stateGate.withLock {
            requireOpen();commit(persisted.copy(navigation = persisted.navigation.copy(catalog = null, readers = emptyList())))
        }
    }

    suspend fun resolveDocument(documentId: String,anchor: String?=null,expectedTarget: NativeDocumentTarget?=null): NativeDocumentResolution {
        return withContext(Dispatchers.Default) {
        requireOpen()
        if(expectedTarget!=null) return@withContext readTarget(expectedTarget)
        engine.awaitReady()
        val local=databaseGate.withLock { requireOpen();database.readSourceDocument(documentId) }
        if(local==null) {
            val target=catalog.resolve(documentId,emptyList(),anchor) ?: return@withContext NativeDocumentResolution.Unavailable("Точная редакция источника отсутствует в каталоге")
            return@withContext readTarget(target)
        }
        val metadata=contentJson.parseToJsonElement(local.metadataJson).jsonObject
        if(metadata.optionalString("contentMode")!="module-pointer") return@withContext checkedDocument(local,local.target.copy(anchor=anchor))
        val targetId=metadata.optionalString("targetDocumentId") ?: return@withContext NativeDocumentResolution.Unavailable("Не указан источник указателя")
        val primary=metadata.optionalString("primaryModuleId") ?: return@withContext NativeDocumentResolution.Unavailable("Не указан модуль источника")
        val ids=(metadata["moduleIds"]?.jsonArray?.map { it.jsonPrimitive.also { value -> require(value.isString) }.content } ?: emptyList())
        val target=catalog.resolve(targetId,listOf(primary)+ids,null) ?: return@withContext NativeDocumentResolution.Unavailable("Точная редакция источника недоступна")
        readTarget(target.copy(anchor=pointerAnchor(local,metadata,anchor,target)))
        }
    }

    internal fun pointerAnchor(local: NativeSourceDocument,metadata: JsonObject,anchor: String?,target: NativeDocumentTarget): String? {
        if(anchor==null) return null
        val mention=(metadata["terminologyMentionAnchors"] as? JsonObject)?.optionalString(anchor)
        if(mention!=null) return mention
        val knownLocalAnchor=local.sections.any { it.anchor==anchor || it.chunks.any { chunk -> chunk.anchor==anchor } }
        if(metadata.optionalString("pointerKind")=="terminology" && knownLocalAnchor) return null
        if(metadata.optionalString("definitionPreviewAnchor")==anchor) return (metadata["canonicalDefinition"] as? JsonObject)?.optionalString("sourceAnchor") ?: anchor
        // Discovery paragraphs are synthesized under the local pointer version, not copied
        // source excerpts. Only a proven exact source tuple permits opening its document start.
        if(knownLocalAnchor && anchor.startsWith(local.target.documentVersionId+"/") &&
            metadata.optionalString("sourceDocumentId")==target.documentId &&
            metadata.optionalString("sourceDocumentVersionId")==target.documentVersionId &&
            metadata.optionalString("sourceChecksum")==target.sourceChecksum) return null
        return anchor
    }

    private fun checkedDocument(document: NativeSourceDocument,target: NativeDocumentTarget): NativeDocumentResolution {
        if(document.target.documentVersionId!=target.documentVersionId || document.target.sourceChecksum!=target.sourceChecksum) return NativeDocumentResolution.Unavailable("Редакция или исходная контрольная сумма не совпадает")
        val metadata=contentJson.parseToJsonElement(document.metadataJson).jsonObject
        if(metadata.optionalString("contentMode")=="module-pointer") return NativeDocumentResolution.Unavailable("Полный источник ещё не установлен")
        if(document.sections.none { it.chunks.any { c -> c.originalText.isNotBlank() } }) return NativeDocumentResolution.Unavailable("Источник не содержит читаемого текста")
        if(target.anchor!=null && document.sections.none { s -> s.anchor==target.anchor || s.chunks.any { it.anchor==target.anchor } }) return NativeDocumentResolution.Unavailable("Исходный якорь отсутствует в этой редакции")
        return NativeDocumentResolution.Readable(document.copy(target=target))
    }

    private suspend fun readTarget(target: NativeDocumentTarget): NativeDocumentResolution = withContext(Dispatchers.Default) {
        validateTarget(target);requireOpen();engine.awaitReady()
        val module=if(target.moduleId!=null) catalog.exact(target) else null
        if(target.moduleId!=null && module==null) return@withContext NativeDocumentResolution.Unavailable("Точная редакция отсутствует в проверенном каталоге")
        if (module != null) {
            val local = databaseGate.withLock { requireOpen();database.readSourceDocument(target.documentId,target.documentVersionId) }
            if (local != null && local.target.sourceChecksum == target.sourceChecksum && contentJson.parseToJsonElement(local.metadataJson).jsonObject.optionalString("contentMode") != "module-pointer") return@withContext checkedDocument(local,target)
        }
        val source=if(module==null) database else mount(module)
        if(source==null) {
            val artifact=try { module!!.index() } catch(cause: IllegalArgumentException) { return@withContext NativeDocumentResolution.Unavailable(cause.message ?: "Модуль несовместим") } catch(cause: IllegalStateException) { return@withContext NativeDocumentResolution.Unavailable(cause.message ?: "Модуль недоступен") }
            return@withContext NativeDocumentResolution.Download(target,module!!.title,artifact.sizeBytes)
        }
        databaseGate.withLock {
            requireOpen()
            val document=source.readSourceDocument(target.documentId,target.documentVersionId) ?: return@withLock NativeDocumentResolution.Unavailable("Документ этой редакции отсутствует в установленном источнике")
            checkedDocument(document,target)
        }
    }

    private suspend fun mount(module: NativeModule): NativeSearchDatabase? {
        val key=module.id+"@"+module.version
        val record=stateGate.withLock { persisted.installed.singleOrNull { it.moduleId==module.id && it.moduleVersion==module.version } } ?: return null
        val artifact=module.index()
        check(record.artifact==artifact && record.sourceSetDigest==module.sourceSetDigest && record.path==contentPath(artifact)) { "Installed module descriptor mismatch" }
        return databaseGate.withLock {
            requireOpen()
            mounted[key]?.let { return@withLock it }
            if (!io.exists(record.path)) return@withLock null
            try { io.verify(record.path,artifact.decodedSha256,artifact.decodedSizeBytes) } catch (cause: NativeContentVerificationException) { return@withLock null }
            val opened=NativeSearchDatabase(io.databasePath(record.path))
            try {
                opened.open();validateModule(opened,module)
                mounted[key]=opened;opened
            } catch(cause: Throwable) { opened.close();throw cause }
        }
    }

    suspend fun openDocument(target: NativeDocumentTarget): NativeDocumentResolution {
        val resolution=readTarget(target)
        if(resolution !is NativeDocumentResolution.Unavailable) stateGate.withLock {
            requireOpen();currentCoroutineContext().ensureActive()
            val readers=persisted.navigation.readers
            val next=if(readers.lastOrNull()?.target==target) readers else (readers+NativeReaderRoute.Document(target)).takeLast(32)
            commit(persisted.copy(navigation=persisted.navigation.copy(readers=next)))
        }
        return resolution
    }

    private fun validateModule(db: NativeSearchDatabase,module: NativeModule) {
        db.validateContent(module.schemaVersion,module.members.map { it.target(module,null) })
        module.definitionDescriptor()?.let { (edition,entries) ->
            val status=db.definitionStatus() ?: error("Missing reference capability")
            check(status.editionId==edition && status.entries==entries) { "Reference catalog edition mismatch" }
        }
    }

    suspend fun install(target: NativeDocumentTarget): NativeDocumentResolution {
        requireOpen();validateTarget(target)
        val module=catalog.exact(target) ?: error("Exact source membership is unavailable")
        return installModule(target,module,{ db ->
            val doc=db.readSourceDocument(target.documentId,target.documentVersionId) ?: error("Missing installed source")
            check(checkedDocument(doc,target) is NativeDocumentResolution.Readable) { "Installed source identity or anchor mismatch" }
        },{ readTarget(target) })
    }

    private suspend fun <T> installModule(target: NativeReaderTarget,module: NativeModule,validate: (NativeSearchDatabase)->Unit,resolve: suspend ()->T): T {
        requireOpen()
        val artifact=module.index()
        val destination=contentPath(artifact)
        val alreadyPresent=io.exists(destination)
        val caller=currentCoroutineContext()[Job]
        val token=stateGate.withLock {
            requireOpen()
            val next=generation.updateAndGet { it+1 }
            activeInstall?.takeUnless { it==caller }?.cancel()
            activeInstall=caller
            failureState.value=null
            next
        }
        try {
            return installGate.withLock {
                checkToken(token)
                val path=installer.prepare(artifact,token,{ progress -> if(generation.value==token && !closed.value) progressState.value=progress }) { db ->
                    validateModule(db,module)
                    validate(db)
                }
                checkToken(token)
                stateGate.withLock {
                    checkToken(token)
                    val record=NativeInstalledModule(module.id,module.version,module.sourceSetDigest!!,artifact,path)
                    val next=persisted.installed.filterNot { it.moduleId==module.id && it.moduleVersion==module.version }+record
                    commit(persisted.copy(installed=next),token)
                }
                checkToken(token)
                resolve()
            }
        } catch (cause: Throwable) {
            if (cause !is CancellationException && generation.value==token && !closed.value) failureState.value=NativeInstallFailure(target,"Не удалось проверить и установить источник. Повторите загрузку.")
            if (!alreadyPresent) withContext(NonCancellable) {
                installGate.withLock { stateGate.withLock { if (persisted.installed.none { it.path == destination }) io.delete(destination) } }
            }
            throw cause
        } finally {
            withContext(NonCancellable) { stateGate.withLock { if(generation.value==token) { progressState.value=null;activeInstall=null } } }
        }
    }

    suspend fun lookupIdentities(query: String): List<NativeCoreIdentityHit> = withContext(Dispatchers.Default) {
        requireOpen();require(query.length<=NATIVE_SEARCH_QUERY_MAX_LENGTH && !query.contains('\u0000')) { "Invalid identity query size" };databaseGate.withLock { requireOpen();database.lookupIdentities(query) }
    }
    suspend fun resolveDefinition(target: NativeDefinitionTarget): NativeDefinitionResolution = withContext(Dispatchers.Default) {
        validateDefinitionTarget(target);requireOpen()
        val module=catalog.exactDefinition(target) ?: return@withContext NativeDefinitionResolution.Unavailable("Точная редакция справочника отсутствует в каталоге")
        val artifact=try { module.index() } catch(cause: IllegalArgumentException) { return@withContext NativeDefinitionResolution.Unavailable(cause.message ?: "Справочник несовместим") } catch(cause: IllegalStateException) { return@withContext NativeDefinitionResolution.Unavailable(cause.message ?: "Справочник недоступен") }
        val db=mount(module) ?: return@withContext NativeDefinitionResolution.Download(target,module.title,artifact.sizeBytes)
        databaseGate.withLock {
            requireOpen()
            val card=db.definitionCard(target.editionId,target.entityId) ?: return@withLock NativeDefinitionResolution.Unavailable("Идентичность отсутствует в этой редакции справочника")
            NativeDefinitionResolution.Readable(target,card)
        }
    }
    suspend fun openDefinition(target: NativeDefinitionTarget): NativeDefinitionResolution {
        val resolution=resolveDefinition(target)
        if(resolution !is NativeDefinitionResolution.Unavailable) stateGate.withLock {
            requireOpen();currentCoroutineContext().ensureActive()
            val readers=persisted.navigation.readers
            val next=if(readers.lastOrNull()?.target==target) readers else (readers+NativeReaderRoute.Definition(target)).takeLast(32)
            commit(persisted.copy(navigation=persisted.navigation.copy(readers=next)))
        }
        return resolution
    }
    suspend fun installDefinition(target: NativeDefinitionTarget): NativeDefinitionResolution {
        validateDefinitionTarget(target);requireOpen()
        val module=catalog.exactDefinition(target) ?: error("Exact reference edition is unavailable")
        return installModule(target,module,{ db -> check(db.definitionCard(target.editionId,target.entityId)!=null) { "Missing exact reference identity" } },{ resolveDefinition(target) })
    }
    private suspend fun <T> readDefinition(target: NativeDefinitionTarget,read: (NativeSearchDatabase)->T): T = withContext(Dispatchers.Default) {
        validateDefinitionTarget(target);requireOpen()
        val module=catalog.exactDefinition(target) ?: error("Exact reference edition is unavailable")
        val db=mount(module) ?: error("Reference edition is not installed")
        databaseGate.withLock {
            requireOpen();check(db.definitionCard(target.editionId,target.entityId)!=null) { "Missing exact reference identity" };read(db)
        }
    }
    suspend fun definitionStatus(target: NativeDefinitionTarget): NativeDefinitionStatus = readDefinition(target) { it.definitionStatus() ?: error("Missing reference capability") }
    suspend fun definitionCard(target: NativeDefinitionTarget): NativeDefinitionCard? = readDefinition(target) { it.definitionCard(target.editionId,target.entityId) }
    suspend fun definitionBlocks(target: NativeDefinitionTarget,after: String=""): NativeDefinitionBlockPage = readDefinition(target) { it.definitionBlocks(target.editionId,target.entityId,after) }
    suspend fun definitionText(target: NativeDefinitionTarget,chunkId: String,offset: Int=0): NativeDefinitionTextPage? = readDefinition(target) { it.definitionText(target.editionId,target.entityId,chunkId,offset) }
    suspend fun definitionSource(target: NativeDefinitionTarget,sourceId: String): NativeDefinitionSource? = readDefinition(target) { it.definitionSource(target.editionId,sourceId) }

    private suspend fun checkToken(token: Long) {
        currentCoroutineContext().ensureActive();requireOpen();if(generation.value!=token) throw CancellationException("Content operation was superseded")
    }
    suspend fun saveSearchSnapshot(snapshot: NativeSearchSnapshot) {
        require(snapshot.firstVisibleItemIndex>=0 && snapshot.firstVisibleItemOffset>=0 && snapshot.query.length<=NATIVE_SEARCH_QUERY_MAX_LENGTH && !snapshot.query.contains('\u0000'))
        stateGate.withLock { requireOpen();commit(persisted.copy(navigation=persisted.navigation.copy(search=snapshot))) }
    }
    suspend fun saveReaderSnapshot(snapshot: NativeReaderRoute) {
        validateReaderRoute(snapshot)
        stateGate.withLock {
            requireOpen()
            if(persisted.navigation.readers.lastOrNull()?.target!=snapshot.target) return@withLock
            commit(persisted.copy(navigation=persisted.navigation.copy(readers=persisted.navigation.readers.dropLast(1)+snapshot)))
        }
    }
    suspend fun back(): NativeNavigationSnapshot = stateGate.withLock {
        requireOpen()
        val navigation = persisted.navigation
        val next = when {
            navigation.readers.isNotEmpty() -> navigation.copy(readers = navigation.readers.dropLast(1))
            navigation.catalog?.moduleId != null -> navigation.copy(catalog = NativeCatalogSnapshot(filterQuery=navigation.catalog.overviewFilterQuery,firstVisibleItemIndex=navigation.catalog.overviewFirstVisibleItemIndex,firstVisibleItemOffset=navigation.catalog.overviewFirstVisibleItemOffset))
            navigation.catalog != null -> navigation.copy(catalog = null)
            else -> navigation
        }
        commit(persisted.copy(navigation = next));persisted.navigation
    }
    suspend fun restoreReader(): NativeReaderResolution? = navigation.value.readers.lastOrNull()?.let {
        when(it) {
            is NativeReaderRoute.Document -> NativeReaderResolution.Document(readTarget(it.target))
            is NativeReaderRoute.Definition -> NativeReaderResolution.Definition(resolveDefinition(it.target))
        }
    }

    private suspend fun commit(next: NativeContentState,token: Long?=null) {
        val before=persisted
        currentCoroutineContext().ensureActive();requireOpen()
        try {
            io.writeTextAtomic(STATE_PATH,contentJson.encodeToString(next))
            currentCoroutineContext().ensureActive();requireOpen()
            if(token!=null) checkToken(token)
            persisted=next;navigationState.value=next.navigation
        } catch(cause: Throwable) {
            withContext(NonCancellable) { io.writeTextAtomic(STATE_PATH,contentJson.encodeToString(before)) }
            throw cause
        }
    }
    suspend fun close() {
        if (!closed.compareAndSet(false, true)) {
            closeFinished.await()
            return
        }
        val caller = currentCoroutineContext()[Job]
        withContext(NonCancellable) {
            try {
                val installation = stateGate.withLock {
                    generation.updateAndGet { it + 1 }
                    progressState.value = null
                    activeInstall.also { activeInstall = null }
                }
                installation?.takeUnless { it == caller }?.cancelAndJoin()
                engine.close()
                installGate.withLock {
                    stateGate.withLock {
                        databaseGate.withLock {
                            mounted.values.forEach { it.close() }
                            mounted.clear()
                            database.close()
                        }
                    }
                }
                closeFinished.complete(Unit)
            } catch (cause: Throwable) {
                closeFinished.completeExceptionally(cause)
                throw cause
            }
        }
    }
    companion object {
        private const val STATE_PATH="native-content-state.json"
        val RELEASE_CORE=NativeArtifact("core-0.6.45","https://github.com/T-Damer/MiniMed/releases/download/core-0.6.45/core.db.gz","sha256:6047b4557f59293d82659f70bcd260af14427817f2d720c943a1b99db3640eef",76212355,"gzip","sha256:13f238f7fefe1b19eefa19ac9de0ea89fabff34ed96e98d987277f15ab03025f",440942592)
        fun hasCachedCore(io: NativeContentIO): Boolean = io.exists(contentPath(RELEASE_CORE))
        private fun contentPath(artifact: NativeArtifact)="content/${artifact.decodedSha256.removePrefix("sha256:")}.db"
        suspend fun open(io: NativeContentIO,catalogJson: String,onProgress: (NativeInstallProgress)->Unit={}): NativeMedicalCore = openWithArtifact(io,catalogJson,RELEASE_CORE,onProgress)
        internal suspend fun openWithArtifact(io: NativeContentIO,catalogJson: String,artifact: NativeArtifact,onProgress: (NativeInstallProgress)->Unit={}): NativeMedicalCore {
            var created: NativeMedicalCore? = null
            try { return withContext(Dispatchers.Default) {
            val catalog=NativeCatalog.parse(catalogJson)
            val state=loadNativeContentState(io,STATE_PATH)
            val path=NativeContentInstaller(io).prepare(artifact,0,onProgress) { it.validateContent(2) }
            currentCoroutineContext().ensureActive()
            val database=NativeSearchDatabase(io.databasePath(path))
            try { database.open();NativeMedicalCore(io,catalog,database,state).also { created=it } } catch(cause: Throwable) { database.close();throw cause }
            } } catch (cause: Throwable) {
                withContext(NonCancellable) { created?.close() }
                throw cause
            }
        }
    }
}
