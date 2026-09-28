package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.golden.readGoldenFixture
import dev.localmed.nativespike.shared.golden.testCoreDbPath
import dev.localmed.nativespike.shared.text.normalizeSurfaceText
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Stage 2 sub-stage A golden-parity check (docs/CURRENT_STATE.md): for every query in
 * `search-golden.json`, compares this Kotlin port's `normalizeSurfaceText`
 * (text/TextNormalization.kt) and `createAliasExpander` (lexical/Aliases.kt) output against what
 * the real TypeScript pipeline recorded (`export-search-golden.ts`). Loads the real `aliases`
 * table from the same core.db the golden fixtures were exported from (verified against
 * `search-golden.json`'s own `coreDbSha256`), not a hand-picked sample, so this is an
 * apples-to-apples comparison, not a synthetic one.
 *
 * Duplicated in `iosTest` (not `commonTest`): wasmJs has neither a real `aliases` table
 * (`NativeSearchDatabase.wasmJs.kt`'s `listAliases()` stub returns empty) nor fixture file access
 * (`GoldenFixture.wasmJs.kt`), so this test cannot run there — putting it in `commonTest` would
 * make `wasmJsBrowserTest` fail instead of simply not covering this platform.
 *
 * Prints a full report (match rate + every discrepancy) rather than asserting an exact 100% match —
 * the migration's own rule (docs/CURRENT_STATE.md) is that a mismatch is either a documented bug to
 * fix or a documented, deliberate difference, decided by a human reading this report, not a
 * hardcoded pass/fail threshold baked into the test itself.
 */
class AliasParityTest {
    @Test
    fun normalize_and_alias_expansion_match_the_real_pipeline() {
        val golden = Json.parseToJsonElement(readGoldenFixture()).jsonObject
        val queries = golden.getValue("queries").jsonArray

        val db = NativeSearchDatabase(testCoreDbPath())
        db.open()
        val aliases = try {
            filterQueryAliases(sortAliasesLikeMultiMedicalStore(db.listAliases()))
        } finally {
            db.close()
        }
        assertTrue(aliases.isNotEmpty(), "listAliases() returned no rows — is CORE_DB_PATH wired to the real core.db?")
        val expander = createAliasExpander(aliases)

        var total = 0
        var normalizedMatches = 0
        var aliasMatches = 0
        val normalizedMismatches = mutableListOf<String>()
        val aliasMismatches = mutableListOf<String>()

        for (entry in queries) {
            val row = entry.jsonObject
            if (row["error"] != null) continue // mirrors export-search-golden.ts's per-query error rows
            val sourceId = row["sourceId"]?.jsonPrimitive?.contentOrNull ?: "?"
            val query = row.getValue("query").jsonPrimitive.content
            val goldenNormalized = row.getValue("normalizedQuery").jsonPrimitive.content
            val goldenAliasMatches = row.getValue("aliasMatches").jsonArray.map { it.jsonPrimitive.content }

            total += 1

            val actualNormalized = normalizeSurfaceText(query)
            if (actualNormalized == goldenNormalized) {
                normalizedMatches += 1
            } else {
                normalizedMismatches.add(
                    "[$sourceId] \"$query\": golden=\"$goldenNormalized\" actual=\"$actualNormalized\"",
                )
            }

            val actualAliasMatches = expander.expand(query).matches
            if (actualAliasMatches == goldenAliasMatches) {
                aliasMatches += 1
            } else {
                aliasMismatches.add(
                    "[$sourceId] \"$query\":\n  golden=$goldenAliasMatches\n  actual=$actualAliasMatches",
                )
            }
        }

        println("=== Stage 2 sub-stage A golden-parity report ===")
        println("queries compared: $total (aliases loaded from core.db: ${aliases.size})")
        println("normalizedQuery match: $normalizedMatches/$total (${formatPercent(normalizedMatches, total)})")
        println("aliasMatches match: $aliasMatches/$total (${formatPercent(aliasMatches, total)})")
        if (normalizedMismatches.isNotEmpty()) {
            println("--- normalizedQuery mismatches (${normalizedMismatches.size}) ---")
            normalizedMismatches.forEach(::println)
        }
        if (aliasMismatches.isNotEmpty()) {
            println("--- aliasMatches mismatches (${aliasMismatches.size}) ---")
            aliasMismatches.forEach(::println)
        }

        assertTrue(total > 100, "expected >100 golden queries, got $total")
    }
}

/** No `String.format`/`java.util.Formatter` here — this test also runs on Kotlin/Native (iosTest),
 * where that JVM-only API is unavailable. */
private fun formatPercent(numerator: Int, denominator: Int): String {
    if (denominator == 0) return "n/a"
    val tenths = kotlin.math.round(numerator.toDouble() / denominator * 1000).toInt()
    return "${tenths / 10}.${tenths % 10}%"
}
