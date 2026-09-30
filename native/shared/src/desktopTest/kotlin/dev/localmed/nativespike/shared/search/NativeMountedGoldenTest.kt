package dev.localmed.nativespike.shared.search

import dev.localmed.nativespike.shared.content.contentJson
import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.golden.testCoreDbPath
import dev.localmed.nativespike.shared.lexical.QueryDocumentIndex
import dev.localmed.nativespike.shared.lexical.analyzeClinicalQuery
import dev.localmed.nativespike.shared.lexical.buildLookupQueryPlan
import dev.localmed.nativespike.shared.lexical.createAliasExpander
import dev.localmed.nativespike.shared.lexical.createMedicationSpellingMatcher
import dev.localmed.nativespike.shared.lexical.filterQueryAliases
import dev.localmed.nativespike.shared.lexical.perBranchLimit
import dev.localmed.nativespike.shared.lexical.resolveMedicationSpellingPlan
import dev.localmed.nativespike.shared.lexical.runLookupPipelineGroups
import dev.localmed.nativespike.shared.model.NativeSearchFilters
import dev.localmed.nativespike.shared.model.NativeSearchMode
import dev.localmed.nativespike.shared.model.NativeSearchScope
import dev.localmed.nativespike.shared.model.NativeSearchSelection
import dev.localmed.nativespike.shared.model.RankedGroup
import java.io.File
import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class NativeMountedGoldenTest {
    private fun sha(file: File): String {
        val digest=MessageDigest.getInstance("SHA-256")
        file.inputStream().use { stream -> val buffer=ByteArray(65536);while(true) { val n=stream.read(buffer);if(n<0) break;digest.update(buffer,0,n) } }
        return digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
    }
    private fun differences(expected: JsonElement,actual: JsonElement,path: String,tolerance: Double=1e-12): List<String> = when {
        expected is JsonObject && actual is JsonObject -> (expected.keys+actual.keys).flatMap { key -> if(expected[key]==null || actual[key]==null) listOf("$path.$key") else differences(expected.getValue(key),actual.getValue(key),"$path.$key",tolerance) }
        expected is JsonArray && actual is JsonArray -> if(expected.size!=actual.size) listOf("$path.size") else expected.indices.flatMap { differences(expected[it],actual[it],"$path[$it]",tolerance) }
        expected is JsonPrimitive && actual is JsonPrimitive && !expected.isString && !actual.isString && expected.doubleOrNull!=null && actual.doubleOrNull!=null -> if(kotlin.math.abs(expected.doubleOrNull!!-actual.doubleOrNull!!)<=tolerance) emptyList() else listOf(path)
        expected==actual -> emptyList()
        else -> listOf(path)
    }
    private fun groupsJson(groups: List<RankedGroup>)=JsonArray(groups.map { group -> JsonObject(mapOf(
        "documentId" to JsonPrimitive(group.documentId),"targetDocumentId" to JsonPrimitive(group.targetDocumentId),
        "documentKind" to (group.documentKind?.let(::JsonPrimitive) ?: JsonNull),"contentKind" to (group.contentKind?.let(::JsonPrimitive) ?: JsonNull),"bestScore" to JsonPrimitive(group.bestScore),
        "results" to JsonArray(group.results.map { result ->
            val source=result.sourceTarget!!
            JsonObject(mapOf("chunkId" to JsonPrimitive(result.chunkId),"documentVersionId" to JsonPrimitive(result.documentVersionId),"sectionId" to JsonPrimitive(result.sectionId),"anchor" to JsonPrimitive(result.anchor),
                "sourceTarget" to JsonObject(mapOf("documentId" to JsonPrimitive(source.documentId),"documentVersionId" to JsonPrimitive(source.documentVersionId),"sourceChecksum" to JsonPrimitive(source.sourceChecksum),"anchor" to JsonPrimitive(source.anchor),"moduleId" to (source.moduleId?.let(::JsonPrimitive) ?: JsonNull),"moduleVersion" to (source.moduleVersion?.let(::JsonPrimitive) ?: JsonNull))),
                "snippet" to JsonPrimitive(result.snippet),"highlightedRanges" to JsonArray(result.highlightedRanges.map { JsonObject(mapOf("start" to JsonPrimitive(it.start),"end" to JsonPrimitive(it.end))) }),
                "matchedTerms" to JsonArray(result.matchedTerms.map(::JsonPrimitive)),"finalScore" to JsonPrimitive(result.finalScore)))
        })
    )) })

    @Test
    fun all94ActualScopedRequestsBranchesAndFullSourceGroupsMatchVerifiedPacks() {
        val fixture=contentJson.parseToJsonElement(File(System.getProperty("TEST_RESOURCE_DIR"),"mounted-search-golden.json").readText()).jsonObject
        val moduleFile=File(System.getProperty("NATIVE_SLICE_ROOT"),"playwright/native-verified-regulatory.db")
        assertEquals(fixture.getValue("coreDbSha256").jsonPrimitive.content,sha(File(testCoreDbPath())))
        assertEquals(fixture.getValue("module").jsonObject.getValue("sha256").jsonPrimitive.content,sha(moduleFile))
        val core=NativeSearchDatabase(testCoreDbPath());val module=NativeSearchDatabase(moduleFile.path)
        core.open();module.open()
        try {
            val coreMount=NativeSearchMount(core,"minimed.core.ru",weight=1.1)
            val moduleDescriptor=fixture.getValue("module").jsonObject
            val worlds=listOf(NativeSearchComposition(listOf(coreMount)),NativeSearchComposition(listOf(coreMount,NativeSearchMount(module,moduleDescriptor.getValue("id").jsonPrimitive.content,moduleDescriptor.getValue("version").jsonPrimitive.content))))
            val failures=mutableListOf<String>();var groupCount=0;var branches=0;var passageCount=0;var pointerCount=0;var mountedCount=0
            for((installed,world) in worlds.withIndex()) {
                val aliases=filterQueryAliases(world.aliases);val index=QueryDocumentIndex(world.documents)
                val expander=createAliasExpander(aliases);val matcher=createMedicationSpellingMatcher(aliases)
                fixture.getValue("queries").jsonArray.forEachIndexed { case,entry ->
                    val row=entry.jsonObject
                    if((row.getValue("installed").jsonPrimitive.content=="true")!=(installed==1)) return@forEachIndexed
                    val query=row.getValue("query").jsonPrimitive.content
                    val mode=contentJson.decodeFromJsonElement<NativeSearchMode>(row.getValue("analysisMode"))
                    val selection=NativeSearchSelection(contentJson.decodeFromJsonElement<NativeSearchScope>(row.getValue("scope")),contentJson.decodeFromJsonElement<NativeSearchFilters>(row.getValue("filters")))
                    val filters=world.filters(selection)
                    val clinical=if(mode==NativeSearchMode.CLINICAL) analyzeClinicalQuery(query,aliases,false,expander.expand(query)) else null
                    val plan=if(clinical==null) resolveMedicationSpellingPlan(buildLookupQueryPlan(query,aliases,expander.expand(query),matcher),core,20,composition=world,filters=filters) else null
                    val actual=world.withSourceTargets(runLookupPipelineGroups(query,aliases,core,index,20,expander,matcher,clinicalPlan=clinical,composition=world,selection=selection))
                    failures+=differences(row.getValue("groups"),groupsJson(actual),"case[$case].groups",1e-6)
                    groupCount+=actual.size;passageCount+=actual.sumOf { it.results.size }
                    actual.flatMap { it.results }.forEach { result ->
                        if(result.documentId.startsWith("core.catalog.pointer.")) { pointerCount++;if(result.target!=null) failures+="case[$case].syntheticNavigationTarget" }
                        if(result.sourceTarget?.moduleId!=null) { mountedCount++;if(result.target!=result.sourceTarget) failures+="case[$case].mountedNavigationTarget" }
                    }
                    val actualBranches=clinical?.branches ?: plan!!.branches
                    val terms=clinical?.terms ?: plan!!.terms
                    failures+=differences(row.getValue("terms"),JsonArray(terms.map(::JsonPrimitive)),"case[$case].terms")
                    val savedBranches=row.getValue("branches").jsonArray
                    if(actualBranches.size!=savedBranches.size) failures+="case[$case].branches.size"
                    actualBranches.take(savedBranches.size).forEachIndexed { position,branch ->
                        branches++;val saved=savedBranches[position].jsonObject;val request=saved.getValue("request").jsonObject
                        val expectedFilters=contentJson.decodeFromJsonElement<NativeSearchFilters>(fixture.getValue("requestFilterSets").jsonArray[request.getValue("filterSetIndex").jsonPrimitive.int])
                        if(filters!=expectedFilters) failures+="case[$case].branches[$position].filters"
                        failures+=differences(request.getValue("terms"),JsonArray(branch.terms.map(::JsonPrimitive)),"case[$case].branches[$position].request.terms")
                        if(branch.id!=saved.getValue("id").jsonPrimitive.content || branch.ftsQuery!=request.getValue("ftsQuery").jsonPrimitive.content || branch.weight!=saved.getValue("weight").jsonPrimitive.doubleOrNull) failures+="case[$case].branches[$position].plan"
                        if(request.getValue("limit").jsonPrimitive.int!=perBranchLimit(20) || (request.getValue("diversifyDocuments").jsonPrimitive.content=="true")!=(mode==NativeSearchMode.LOOKUP)) failures+="case[$case].branches[$position].request"
                        val hits=world.search(branch.ftsQuery,perBranchLimit(20),filters,mode==NativeSearchMode.LOOKUP)
                        if(hits.size!=saved.getValue("candidateCount").jsonPrimitive.int) failures+="case[$case].branches[$position].candidateCount"
                        val top=JsonArray(hits.take(10).mapIndexed { index,hit -> JsonObject(mapOf("chunkId" to JsonPrimitive(hit.chunkId),"rank" to JsonPrimitive(hit.rank),"position" to JsonPrimitive(index))) })
                        failures+=differences(saved.getValue("topHits"),top,"case[$case].branches[$position].topHits")
                    }
                }
            }
            val report=JsonObject(mapOf("cases" to JsonPrimitive(94),"groups" to JsonPrimitive(groupCount),"branches" to JsonPrimitive(branches),"passages" to JsonPrimitive(passageCount),"pointerProvenanceTargets" to JsonPrimitive(pointerCount),"mountedReadableTargets" to JsonPrimitive(mountedCount),"differences" to JsonArray(failures.map(::JsonPrimitive))))
            File(System.getProperty("NATIVE_SLICE_ROOT"),"playwright/native-mounted-parity.json").writeText(report.toString())
            assertTrue(pointerCount>0 && mountedCount>0)
            assertTrue(failures.isEmpty(),"Mounted source mismatch paths: ${failures.take(35).joinToString()}")
        } finally { core.close();module.close() }
    }
}
