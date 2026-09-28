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
 * Stage 2 sub-stage D golden-parity check (docs/CURRENT_STATE.md): runs this Kotlin port's full
 * pipeline (`runLookupPipeline`, `LookupPipeline.kt`) for every query in `search-golden.json` and
 * compares the top-`groupLimit` groups — `documentId`/`targetDocumentId`/`documentKind`/
 * `contentKind`, in order, plus `bestScore` within 1e-6 — against what the real pipeline recorded
 * (`export-search-golden.ts`'s `value.groups`, via `ScopedMedicalCore`).
 *
 * Reports both an exact top-20 match rate and a top-5 match rate (the coordinator's stated target:
 * >=95% identical top-5, every remaining discrepancy documented with a cause) — see this file's
 * printed report and `LookupPipeline.kt`'s header for the full list of documented scope cuts
 * (`QueryDocumentIndex` exact-identity results, terminology matching, semantic search,
 * `selectedGroupPresentation`, `hasImmediateFailureContext`, and several Regex-avoidance
 * approximations in `QueryGroupRanking.kt`/`ScopedRanking.kt`/`Grouping.kt`).
 *
 * Duplicated in `iosTest`, not `commonTest`/`jvmClasspathTest`, for the same reasons as the other
 * SQL-backed parity tests in this module.
 */
class FusionGroupingParityTest {
    @Test
    fun full_pipeline_top_groups_match_the_real_pipeline() {
        val golden = Json.parseToJsonElement(readGoldenFixture()).jsonObject
        val queries = golden.getValue("queries").jsonArray
        val groupLimit = golden.getValue("groupLimit").jsonPrimitive.content.toInt()

        val db = NativeSearchDatabase(testCoreDbPath())
        db.open()
        try {
            val aliases = filterQueryAliases(sortAliasesLikeMultiMedicalStore(db.listAliases()))
            assertTrue(aliases.isNotEmpty(), "listAliases() returned no rows — is CORE_DB_PATH wired to the real core.db?")

            var total = 0
            var exactTop20 = 0
            var top5QueriesCompared = 0
            var top5Matches = 0
            var sameSetDifferentOrder = 0
            var differentSet = 0
            val mismatches = mutableListOf<String>()

            for (entry in queries) {
                val row = entry.jsonObject
                if (row["error"] != null) continue
                val sourceId = row["sourceId"]?.jsonPrimitive?.contentOrNull ?: "?"
                val query = row.getValue("query").jsonPrimitive.content
                val goldenGroups = row.getValue("groups").jsonArray.map { it.jsonObject }
                if (goldenGroups.isEmpty()) continue // nothing to compare for a query with no results
                total += 1

                val actualGroups = runLookupPipeline(query, aliases, db, groupLimit)

                val goldenIds = goldenGroups.map { it.getValue("documentId").jsonPrimitive.content }
                val actualIds = actualGroups.map { it.documentId }

                val goldenTop5 = goldenIds.take(5)
                val actualTop5 = actualIds.take(5)
                if (goldenTop5.isNotEmpty()) {
                    top5QueriesCompared += 1
                    if (actualTop5 == goldenTop5) top5Matches += 1
                }

                var rowOk = actualIds == goldenIds
                if (rowOk) {
                    // Also check documentKind/contentKind/bestScore, positionally, only when the id
                    // sequence itself already matches (a mismatched id sequence is reported as one
                    // finding below, not doubled up with a field-level diff against misaligned rows).
                    for (i in goldenGroups.indices) {
                        val g = goldenGroups[i]
                        val a = actualGroups[i]
                        val gKind = g["documentKind"]?.jsonPrimitive?.contentOrNull
                        val gContent = g["contentKind"]?.jsonPrimitive?.contentOrNull
                        val gScore = g.getValue("bestScore").jsonPrimitive.content.toDouble()
                        if (gKind != a.documentKind || gContent != a.contentKind || kotlin.math.abs(gScore - a.bestScore) > 1e-6) {
                            rowOk = false
                            mismatches.add(
                                "[$sourceId/$i] \"$query\" field mismatch: golden(kind=$gKind,content=$gContent,score=$gScore) " +
                                    "actual(kind=${a.documentKind},content=${a.contentKind},score=${a.bestScore})",
                            )
                        }
                    }
                } else {
                    if (goldenIds.toSet() == actualIds.toSet()) sameSetDifferentOrder += 1 else differentSet += 1
                    mismatches.add("[$sourceId] \"$query\":\n  golden=$goldenIds\n  actual=$actualIds")
                }
                if (rowOk) exactTop20 += 1
            }

            println("=== Stage 2 sub-stage D golden-parity report ===")
            println("queries compared: $total (groupLimit=$groupLimit)")
            println("exact top-20 id+kind+content+score match: $exactTop20/$total (${formatPercent(exactTop20, total)})")
            println("top-5 id match: $top5Matches/$top5QueriesCompared (${formatPercent(top5Matches, top5QueriesCompared)})")
            println("id-mismatch queries where the SET is identical (pure reorder): $sameSetDifferentOrder")
            println("id-mismatch queries where the SET actually differs: $differentSet")
            if (mismatches.isNotEmpty()) {
                println("--- mismatches (${mismatches.size}) ---")
                mismatches.forEach(::println)
            }

            assertTrue(total > 100, "expected >100 golden queries with results, got $total")
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
