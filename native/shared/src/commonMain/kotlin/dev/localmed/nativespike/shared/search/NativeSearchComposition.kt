package dev.localmed.nativespike.shared.search

import dev.localmed.nativespike.shared.core.NativeDocumentTarget
import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.lexical.documentMatchesSearchScope
import dev.localmed.nativespike.shared.lexical.localeCompareApprox
import dev.localmed.nativespike.shared.model.AliasRecord
import dev.localmed.nativespike.shared.model.BranchHit
import dev.localmed.nativespike.shared.model.HydratedHit
import dev.localmed.nativespike.shared.model.NativeSearchFilters
import dev.localmed.nativespike.shared.model.NativeSearchScope
import dev.localmed.nativespike.shared.model.NativeSearchSelection
import dev.localmed.nativespike.shared.model.RankedGroup
import dev.localmed.nativespike.shared.model.SearchVersionIdentity
import dev.localmed.nativespike.shared.model.SearchDocumentSummary

/** Existing readonly handles owned by NativeMedicalCore. Composition never opens or closes them. */
data class NativeSearchMount(val database: NativeSearchDatabase,val moduleId: String,val moduleVersion: String? = null,
    val weight: Double = 1.0,val expectedSources: List<NativeDocumentTarget> = emptyList())

/** One immutable admitted generation, consumed under the existing database owner gate. */
class NativeSearchComposition(mounts: List<NativeSearchMount>) {
    val mounts=mounts.sortedWith(compareByDescending<NativeSearchMount> { it.weight }.thenComparator { a,b -> localeCompareApprox(a.moduleId,b.moduleId) })
    val documents: List<SearchDocumentSummary>
    val documentsById: Map<String,SearchDocumentSummary>
    private val owners=linkedMapOf<String,NativeSearchMount>()
    private val versions=linkedMapOf<String,Pair<NativeSearchMount,SearchVersionIdentity>>()
    val aliases: List<AliasRecord>
    init {
        require(this.mounts.isNotEmpty())
        require(this.mounts.map { it.moduleId }.distinct().size==this.mounts.size) { "Duplicate active search mount" }
        // Capability rejection precedes every generic document/alias/FTS read.
        this.mounts.forEach { require(it.database.definitionStatus()==null) { "Definition editions cannot enter document search" } }
        val inventories=this.mounts.map { it to it.database.listSearchDocuments() }
        documents=inventories.flatMap { it.second };documentsById=documents.associateBy { it.id }
        val packs=mutableSetOf<String>();val collected=linkedMapOf<String,AliasRecord>()
        inventories.forEach { (mount,inventory) ->
            mount.database.contentPackIds().forEach { require(packs.add(it)) { "Duplicate active content pack" } }
            inventory.forEach { require(owners.put(it.id,mount)==null) { "Duplicate active document identity" } }
            val actual=mount.database.documentVersionIdentities()
            if(mount.expectedSources.isNotEmpty()) {
                val expected=mount.expectedSources.map { SearchVersionIdentity(it.documentId,it.documentVersionId,it.sourceChecksum) }.toSet()
                require(actual.toSet()==expected) { "Installed search membership differs from the verified catalog" }
            }
            actual.forEach { require(versions.put(it.versionId,mount to it)==null) { "Duplicate active document version" } }
            mount.database.listAliases().forEach { alias ->
                val old=collected[alias.id]
                require(old==null || old==alias) { "Conflicting active alias identity" };collected[alias.id]=alias
            }
        }
        aliases=collected.values.sortedWith { a,b -> localeCompareApprox(a.alias,b.alias) }
    }

    fun filters(selection: NativeSearchSelection): NativeSearchFilters {
        val requested=selection.filters
        if(selection.scope==NativeSearchScope.ALL || selection.scope==NativeSearchScope.DIAGNOSIS) return requested
        val available=documents.filter { documentMatchesSearchScope(it,selection.scope) }.map { it.id }.toSet()
        val selected=if(requested.documentIds.isEmpty()) available.toList() else requested.documentIds.filter { it in available }
        return requested.copy(documentIds=selected.ifEmpty { listOf("__minimed_empty_search_scope__") })
    }

    fun search(ftsQuery: String,limit: Int,filters: NativeSearchFilters,diversify: Boolean): List<BranchHit> {
        val fused=linkedMapOf<String,BranchHit>()
        mounts.forEach { mount ->
            mount.database.searchBranch(ftsQuery,limit,diversifyDocuments=diversify,filters=filters).forEachIndexed { index,hit ->
                require(fused[hit.chunkId]?.mountId?.let { it==mount.moduleId }!=false) { "Duplicate active chunk identity" }
                val candidate=hit.copy(rank=mount.weight/(60+index+1),mountId=mount.moduleId)
                if(fused[hit.chunkId]?.let { candidate.rank>it.rank }!=false) fused[hit.chunkId]=candidate
            }
        }
        return fused.values.sortedByDescending { it.rank }.take(limit)
    }

    fun hydrate(hits: List<BranchHit>): List<HydratedHit> = mounts.flatMap { mount ->
        val requested=hits.filter { it.mountId==mount.moduleId || (it.mountId==null && mount==mounts.first()) }
        mount.database.hydrateHits(requested.map { it.chunkId }).onEach { hit ->
            val identity=versions[hit.documentVersionId]
            require(identity!=null && identity.first===mount && identity.second.documentId==hit.documentId) { "Hydrated source differs from its admitted owner" }
        }
    }
    fun texts(chunkIds: List<String>): List<dev.localmed.nativespike.shared.model.ExactSubjectHitText> {
        val owners=mutableSetOf<String>()
        return mounts.flatMap { mount -> mount.database.textsForChunks(chunkIds).onEach { text ->
            require(text.chunkId!=null && owners.add(text.chunkId)) { "Duplicate requested source text identity" }
        } }
    }
    fun firstReadable(documentId: String,filters: NativeSearchFilters)=owners[documentId]?.database?.firstReadableChunk(documentId,filters)

    fun withSourceTargets(groups: List<RankedGroup>): List<RankedGroup> = groups.map { group -> group.copy(results=group.results.map { result ->
        val (mount,version)=versions[result.documentVersionId] ?: error("Search result version is outside the admitted generation")
        check(version.documentId==result.documentId) { "Search result document/version mismatch" }
        val target=NativeDocumentTarget(result.documentId,result.documentVersionId,version.sourceChecksum,result.anchor,
            if(mount.moduleVersion==null) null else mount.moduleId,mount.moduleVersion)
        result.copy(sourceTarget=target,target=if(documentsById[result.documentId]?.descriptor?.contentMode=="module-pointer") null else target)
    }) }
}
