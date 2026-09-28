package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.golden.readGoldenFixture
import dev.localmed.nativespike.shared.golden.testCoreDbPath
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Stage 2 sub-stage C golden-parity check (docs/CURRENT_STATE.md): for every query in
 * `search-golden.json`, runs this Kotlin port's plan (`buildLookupQueryPlan`, sub-stage B) through
 * the new SQL execution layer (`NativeSearchDatabase.searchBranch`, `SearchExecution.kt`) and
 * compares each branch's `topHits` — chunk id, in rank order — against what the real TypeScript
 * pipeline recorded (`export-search-golden.ts` re-running `store.search({ftsQuery: branch.ftsQuery,
 * limit: HITS_PER_BRANCH})` directly per branch, `HITS_PER_BRANCH = 10`).
 *
 * Also exercises `resolveMedicationSpellingPlan` (the `hitsContainExactSubject` SQL-dependent
 * reversion deferred from sub-stage B) on every query, including the one query with an actual
 * medication-spelling suggestion — confirming it correctly does NOT revert there (matches golden,
 * which keeps the suggestion), i.e. this sub-stage closes sub-stage B's documented gap rather than
 * merely working around it.
 *
 * Duplicated in `iosTest`, not `commonTest`/`jvmClasspathTest`, for the same reasons as
 * `AliasParityTest`/`LookupPlanParityTest` (wasmJs has no real SQLite; Android's local unit tests
 * cannot load the bundled SQLite native library).
 */
class SqlBranchExecutionParityTest {
    @Test
    fun branch_sql_execution_matches_the_real_pipeline() {
        val golden = Json.parseToJsonElement(readGoldenFixture()).jsonObject
        val queries = golden.getValue("queries").jsonArray
        val groupLimit = golden.getValue("groupLimit").jsonPrimitive.content.toInt()
        val hitsPerBranch = golden.getValue("hitsPerBranch").jsonPrimitive.content.toInt()

        val db = NativeSearchDatabase(testCoreDbPath())
        db.open()
        try {
            val aliases = filterQueryAliases(sortAliasesLikeMultiMedicalStore(db.listAliases()))
            assertTrue(aliases.isNotEmpty(), "listAliases() returned no rows — is CORE_DB_PATH wired to the real core.db?")

            var totalBranches = 0
            var branchesOk = 0
            var revertedWhenGoldenKept = 0
            val mismatches = mutableListOf<String>()

            for (entry in queries) {
                val row = entry.jsonObject
                if (row["error"] != null) continue
                val sourceId = row["sourceId"]?.jsonPrimitive?.contentOrNull ?: "?"
                val query = row.getValue("query").jsonPrimitive.content
                val goldenBranches = row.getValue("branches").jsonArray.map { it.jsonObject }

                val builtPlan = buildLookupQueryPlan(query, aliases)
                val hadSpelling = builtPlan.medicationSpelling != null
                val plan = resolveMedicationSpellingPlan(builtPlan, db, groupLimit)
                if (hadSpelling && plan.medicationSpelling == null && goldenBranches.any { it.getValue("id").jsonPrimitive.content.startsWith("medication-spelling-") }) {
                    revertedWhenGoldenKept += 1
                    mismatches.add("[$sourceId] \"$query\": reverted medication spelling but golden kept it")
                }

                val actualById = plan.branches.associateBy { it.id }
                for (goldenBranch in goldenBranches) {
                    val id = goldenBranch.getValue("id").jsonPrimitive.content
                    val actualBranch = actualById[id] ?: continue // branch-set mismatches are sub-stage B's job
                    totalBranches += 1
                    val goldenHits = goldenBranch.getValue("topHits").jsonArray.map { it.jsonObject }
                    val goldenChunkIds = goldenHits.map { it.getValue("chunkId").jsonPrimitive.content }
                    val actualHits = executeBranch(db, actualBranch.ftsQuery, hitsPerBranch)
                    val actualChunkIds = actualHits.map { it.chunkId }
                    if (actualChunkIds == goldenChunkIds) {
                        branchesOk += 1
                    } else {
                        mismatches.add(
                            "[$sourceId/$id] \"$query\":\n  golden=$goldenChunkIds\n  actual=$actualChunkIds",
                        )
                    }
                }
            }

            println("=== Stage 2 sub-stage C golden-parity report ===")
            println("branches compared: $totalBranches (groupLimit=$groupLimit, hitsPerBranch=$hitsPerBranch)")
            println("topHits (chunkId sequence) match: $branchesOk/$totalBranches (${formatPercent(branchesOk, totalBranches)})")
            println("medication-spelling wrongly reverted: $revertedWhenGoldenKept")
            if (mismatches.isNotEmpty()) {
                println("--- mismatches (${mismatches.size}) ---")
                mismatches.forEach(::println)
            }

            assertTrue(totalBranches > 100, "expected >100 branches compared, got $totalBranches")
        } finally {
            db.close()
        }
    }
}

private fun formatPercent(numerator: Int, denominator: Int): String {
    if (denominator == 0) return "n/a"
    val tenths = kotlin.math.round(numerator.toDouble() / denominator * 1000).toInt()
    return "${tenths / 10}.${tenths % 10}%"
}
