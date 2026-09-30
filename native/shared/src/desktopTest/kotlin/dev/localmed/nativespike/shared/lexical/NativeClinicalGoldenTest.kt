package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.golden.testCoreDbPath
import dev.localmed.nativespike.shared.model.QueryAnalysis
import dev.localmed.nativespike.shared.text.normalizeSurfaceText
import java.io.File
import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.JsonNull
import dev.localmed.nativespike.shared.model.RankedGroup

@OptIn(ExperimentalSerializationApi::class)
class NativeClinicalGoldenTest {
    private val json=Json { explicitNulls=true;encodeDefaults=false }
    private fun differences(expected: JsonElement,actual: JsonElement,path: String,tolerance: Double=1e-12): List<String> = when {
        expected is JsonObject && actual is JsonObject -> (expected.keys+actual.keys).flatMap { key ->
            if(expected[key]==null || actual[key]==null) listOf("$path.$key") else differences(expected.getValue(key),actual.getValue(key),"$path.$key",tolerance)
        }
        expected is JsonArray && actual is JsonArray -> if(expected.size!=actual.size) listOf("$path.size") else expected.indices.flatMap { differences(expected[it],actual[it],"$path[$it]",tolerance) }
        expected is JsonPrimitive && actual is JsonPrimitive && !expected.isString && !actual.isString && expected.doubleOrNull!=null && actual.doubleOrNull!=null -> if(kotlin.math.abs(expected.doubleOrNull!!-actual.doubleOrNull!!)<=tolerance) emptyList() else listOf(path)
        expected==actual -> emptyList()
        else -> listOf(path)
    }

    private fun groupJson(group: RankedGroup): JsonObject = JsonObject(mapOf(
        "documentId" to JsonPrimitive(group.documentId), "targetDocumentId" to JsonPrimitive(group.targetDocumentId),
        "documentKind" to (group.documentKind?.let(::JsonPrimitive) ?: JsonNull),
        "contentKind" to (group.contentKind?.let(::JsonPrimitive) ?: JsonNull), "bestScore" to JsonPrimitive(group.bestScore),
        "results" to JsonArray(group.results.map { result -> JsonObject(mapOf(
            "chunkId" to JsonPrimitive(result.chunkId), "documentVersionId" to JsonPrimitive(result.documentVersionId),
            "sectionId" to JsonPrimitive(result.sectionId), "anchor" to JsonPrimitive(result.anchor),
            "snippet" to JsonPrimitive(result.snippet),
            "highlightedRanges" to JsonArray(result.highlightedRanges.map { JsonObject(mapOf("start" to JsonPrimitive(it.start),"end" to JsonPrimitive(it.end))) }),
            "matchedTerms" to JsonArray(result.matchedTerms.map(::JsonPrimitive)), "finalScore" to JsonPrimitive(result.finalScore),
        )) }),
    ))

    @Test
    fun all85ClinicalGroupsFullPassagesAndProductionBranchWindowsMatchReleasedCore() {
        val fixture=json.parseToJsonElement(File(System.getProperty("TEST_RESOURCE_DIR"),"clinical-golden.json").readText()).jsonObject
        val db=NativeSearchDatabase(testCoreDbPath());db.open()
        try {
            val aliases=filterQueryAliases(sortAliasesLikeMultiMedicalStore(db.listAliases()))
            val index=buildQueryDocumentIndex(db);val expander=createAliasExpander(aliases)
            val failures=mutableListOf<String>();var branchCount=0;var passageCount=0;var nonDiversifiedBranches=0
            fixture.getValue("queries").jsonArray.forEachIndexed { case,value ->
                val row=value.jsonObject;val query=row.getValue("query").jsonPrimitive.content
                val plan=analyzeClinicalQuery(query,aliases,false,expander.expand(query))
                val actual=runLookupPipelineGroups(query,aliases,db,index,fixture.getValue("groupLimit").jsonPrimitive.int,expander,clinicalPlan=plan)
                // Group/passage scores are rounded to six decimal places by the production exporter.
                failures.addAll(differences(row.getValue("groups"),JsonArray(actual.map(::groupJson)),"case[$case].groups",1e-6))
                passageCount+=actual.sumOf { it.results.size }
                plan.branches.forEachIndexed { position,branch ->
                    branchCount++
                    val saved=row.getValue("branches").jsonArray[position].jsonObject
                    val hits=executeBranch(db,branch.ftsQuery,fixture.getValue("hitsPerBranch").jsonPrimitive.int,false)
                    val topHits=JsonArray(hits.mapIndexed { hitPosition,hit -> JsonObject(mapOf("chunkId" to JsonPrimitive(hit.chunkId),"rank" to JsonPrimitive(hit.rank),"position" to JsonPrimitive(hitPosition))) })
                    failures.addAll(differences(saved.getValue("topHits"),topHits,"case[$case].branches[$position].topHits"))
                    val candidateWindow=executeBranch(db,branch.ftsQuery,perBranchLimit(fixture.getValue("groupLimit").jsonPrimitive.int),false)
                    if(saved.getValue("candidateCount").jsonPrimitive.int!=candidateWindow.size) failures.add("case[$case].branches[$position].candidateCount")
                    val lookup=executeBranch(db,branch.ftsQuery,fixture.getValue("hitsPerBranch").jsonPrimitive.int)
                    if(lookup.map { it.chunkId }!=hits.map { it.chunkId }) nonDiversifiedBranches++
                }
            }
            val directory=File(System.getProperty("NATIVE_SLICE_ROOT"),"playwright/native-clinical");directory.mkdirs()
            File(directory,"clinical-retrieval-parity.json").writeText(JsonObject(mapOf(
                "cases" to JsonPrimitive(85),"branches" to JsonPrimitive(branchCount),"passages" to JsonPrimitive(passageCount),
                "branchesDifferentFromLookupQuota" to JsonPrimitive(nonDiversifiedBranches),
                "differences" to JsonArray(failures.map(::JsonPrimitive)),
            )).toString())
            assertTrue(nonDiversifiedBranches>0,"Real clinical fixture must exercise the mode-specific quota")
            assertTrue(failures.isEmpty(),"Clinical retrieval mismatch paths: ${failures.take(35).joinToString()}")
        } finally { db.close() }
    }

    @Test
    fun all85ProductionAnalysesFactsContextsAndOrderedBranchesMatchReleasedCore() {
        val fixture=json.parseToJsonElement(File(System.getProperty("TEST_RESOURCE_DIR"),"clinical-golden.json").readText()).jsonObject
        val source=File(testCoreDbPath());val hash=MessageDigest.getInstance("SHA-256")
        source.inputStream().use { stream -> val bytes=ByteArray(65536);while(true) { val n=stream.read(bytes);if(n<0) break;hash.update(bytes,0,n) } }
        val sha=hash.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
        assertTrue(sha==fixture.getValue("coreDbSha256").jsonPrimitive.content,"Clinical source SHA mismatch")
        val db=NativeSearchDatabase(source.path)
        val aliases=try { db.open();filterQueryAliases(sortAliasesLikeMultiMedicalStore(db.listAliases())) } finally { db.close() }
        val expander=createAliasExpander(aliases)
        val rows=fixture.getValue("queries").jsonArray;assertTrue(rows.size==85,"Clinical oracle count changed")
        var branches=0;var facts=0
        val failures=mutableListOf<String>()
        rows.forEachIndexed { index,value ->
            val row=value.jsonObject;val query=row.getValue("query").jsonPrimitive.content
            val plan=analyzeClinicalQuery(query,aliases,false,expander.expand(normalizeSurfaceText(query)))
            failures.addAll(differences(row.getValue("analysis"),json.encodeToJsonElement<QueryAnalysis>(plan.analysis),"case[$index].analysis"))
            failures.addAll(differences(row.getValue("terms"),JsonArray(plan.terms.map(::JsonPrimitive)),"case[$index].terms"))
            failures.addAll(differences(row.getValue("aliasMatches"),JsonArray(plan.aliasMatches.map(::JsonPrimitive)),"case[$index].aliases"))
            val expected=row.getValue("branches").jsonArray.map { branch -> JsonObject(branch.jsonObject.filterKeys { it in setOf("id","label","weight","ftsQuery") }) }
            val actual=plan.branches.map { JsonObject(mapOf("id" to JsonPrimitive(it.id),"label" to JsonPrimitive(it.label),"weight" to JsonPrimitive(it.weight),"ftsQuery" to JsonPrimitive(it.ftsQuery))) }
            failures.addAll(differences(JsonArray(expected),JsonArray(actual),"case[$index].branches"))
            branches+=plan.branches.size;facts+=plan.analysis.facts.size
        }
        val directory=File(System.getProperty("NATIVE_SLICE_ROOT"),"playwright/native-clinical");directory.mkdirs()
        File(directory,"clinical-analysis-parity.json").writeText(JsonObject(mapOf("cases" to JsonPrimitive(rows.size),"branches" to JsonPrimitive(branches),"facts" to JsonPrimitive(facts),"coreSha256" to JsonPrimitive(sha),"differences" to JsonArray(failures.map(::JsonPrimitive)))).toString())
        assertTrue(failures.isEmpty(),"Clinical parity differs at ${failures.take(30).joinToString()}; see playwright clinical-analysis-parity.json")
        assertTrue(branches==356 && facts==152,"Clinical plan counts differ")
    }
}
