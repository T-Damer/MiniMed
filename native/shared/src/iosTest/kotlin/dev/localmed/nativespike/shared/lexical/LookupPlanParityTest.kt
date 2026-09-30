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
 * Stage 2 sub-stage B golden-parity check (docs/CURRENT_STATE.md): for every query in
 * `search-golden.json`, compares this Kotlin port's `buildLookupQueryPlan`
 * (`MedicationLookupPlan.kt`, the public one — medication-lookup.ts's wrapper around analysis.ts's
 * own, exactly what `create-medical-core.ts` actually calls) against what the real TypeScript
 * pipeline recorded: `aliasMatches` (full array, including any
 * `"<word> → <name> (возможная опечатка)"` medication-spelling entries) and `branches` (by `id`:
 * `weight` and `ftsQuery`).
 *
 * `terms` per branch is NOT compared directly: `export-search-golden.ts` only has access to the
 * search response's `diagnostics.branches`, whose shape (`create-medical-core.ts`'s
 * `runBranchSearches`) is `{id, label, ftsQuery, candidateCount, elapsedMs, weight}` — no per-branch
 * `terms` field, and adding one would require editing `packages/core` (out of bounds for this
 * migration — only `tools/benchmarks` may change). `ftsQuery` is `terms.map(ftsToken).join(' OR ')`
 * plus the ICD legacy queries, so an exact `ftsQuery` match is strong indirect evidence `terms` also
 * matched; this test additionally compares the UNION of every branch's terms (`plan.terms`) against
 * golden's flat top-level `terms` field (`diagnostics.terms`, the one field that *is* exposed) as a
 * set, for a direct (if coarser) terms-level signal.
 *
 * KNOWN, DIAGNOSED SOURCE OF DIVERGENCE (SQL-execution-dependent, not a plan-building bug): the
 * real pipeline's medication-spelling branches/aliasMatches entries are only KEPT if
 * `hitsContainExactSubject(...)` (create-medical-core.ts) finds the typed word absent from the
 * *actual SQL search hits* of the base branches — otherwise `plan` reverts to
 * `spelling.withoutSpelling` (no spelling suggestion at all). That check needs real chunk text from
 * SQL execution (stage 2 sub-stage C), not just the query and alias vocabulary, so this port always
 * applies a spelling suggestion when `MedicationSpelling.kt`'s matcher finds one — for a query where
 * the real pipeline reverted it (typed word actually present in the corpus), this test will show a
 * legitimate mismatch, diagnosed as deferred to sub-stage C, not fixed here.
 *
 * Duplicated in `iosTest`, not `commonTest`/`jvmClasspathTest`, for the same reasons as
 * `AliasParityTest` (wasmJs has no real `aliases` table or fixture access; Android's local unit
 * tests cannot load the bundled SQLite native library — see that test's header).
 */
class LookupPlanParityTest {
    @Test
    fun lookup_plan_matches_the_real_pipeline() {
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

        var total = 0
        var aliasMatchesOk = 0
        var branchesOk = 0
        var unionTermsOk = 0
        val aliasMismatches = mutableListOf<String>()
        val branchMismatches = mutableListOf<String>()
        val termsMismatches = mutableListOf<String>()

        for (entry in queries) {
            val row = entry.jsonObject
            if (row["error"] != null) continue
            val sourceId = row["sourceId"]?.jsonPrimitive?.contentOrNull ?: "?"
            val query = row.getValue("query").jsonPrimitive.content
            val goldenAliasMatches = row.getValue("aliasMatches").jsonArray.map { it.jsonPrimitive.content }
            val goldenBranches = row.getValue("branches").jsonArray.map { it.jsonObject }
            val goldenTerms = row.getValue("terms").jsonArray.map { it.jsonPrimitive.content }.toSet()

            total += 1
            val plan = buildLookupQueryPlan(query, aliases)

            if (plan.aliasMatches == goldenAliasMatches) {
                aliasMatchesOk += 1
            } else {
                aliasMismatches.add(
                    "[$sourceId] \"$query\":\n  golden=${goldenAliasMatches}\n  actual=${plan.aliasMatches}",
                )
            }

            val actualById = plan.branches.associateBy { it.id }
            val goldenById = goldenBranches.associateBy { it.getValue("id").jsonPrimitive.content }
            val branchIdsMatch = actualById.keys == goldenById.keys
            val fieldsMatch = branchIdsMatch && goldenById.all { (id, goldenBranch) ->
                val actual = actualById.getValue(id)
                val goldenWeight = goldenBranch.getValue("weight").jsonPrimitive.content.toDouble()
                val goldenFts = goldenBranch.getValue("ftsQuery").jsonPrimitive.content
                actual.ftsQuery == goldenFts && kotlin.math.abs(actual.weight - goldenWeight) < 1e-9
            }
            if (fieldsMatch) {
                branchesOk += 1
            } else {
                val detail = StringBuilder("[$sourceId] \"$query\":\n")
                detail.append("  golden branch ids=${goldenById.keys}\n  actual branch ids=${actualById.keys}\n")
                for (id in (goldenById.keys + actualById.keys)) {
                    val g = goldenById[id]
                    val a = actualById[id]
                    if (g == null) {
                        detail.append("  [$id] only in actual: weight=${a?.weight} ftsQuery=${a?.ftsQuery}\n")
                    } else if (a == null) {
                        detail.append(
                            "  [$id] only in golden: weight=${g.getValue("weight").jsonPrimitive.content} " +
                                "ftsQuery=${g.getValue("ftsQuery").jsonPrimitive.content}\n",
                        )
                    } else {
                        val gFts = g.getValue("ftsQuery").jsonPrimitive.content
                        val gWeight = g.getValue("weight").jsonPrimitive.content
                        if (a.ftsQuery != gFts) {
                            detail.append("  [$id] ftsQuery differs:\n    golden=$gFts\n    actual=${a.ftsQuery}\n")
                        }
                        if (kotlin.math.abs(a.weight - gWeight.toDouble()) >= 1e-9) {
                            detail.append("  [$id] weight differs: golden=$gWeight actual=${a.weight}\n")
                        }
                    }
                }
                branchMismatches.add(detail.toString())
            }

            val actualTerms = plan.terms.toSet()
            if (actualTerms == goldenTerms) {
                unionTermsOk += 1
            } else {
                val onlyGolden = goldenTerms - actualTerms
                val onlyActual = actualTerms - goldenTerms
                termsMismatches.add(
                    "[$sourceId] \"$query\": only-in-golden=$onlyGolden only-in-actual=$onlyActual",
                )
            }
        }

        println("=== Stage 2 sub-stage B golden-parity report ===")
        println("queries compared: $total (aliases loaded from core.db: ${aliases.size})")
        println("aliasMatches match: $aliasMatchesOk/$total (${formatPercent(aliasMatchesOk, total)})")
        println("branches (id set + per-branch weight/ftsQuery) match: $branchesOk/$total (${formatPercent(branchesOk, total)})")
        println("union terms (plan.terms as a set vs golden diagnostics.terms) match: $unionTermsOk/$total (${formatPercent(unionTermsOk, total)})")
        if (aliasMismatches.isNotEmpty()) {
            println("--- aliasMatches mismatches (${aliasMismatches.size}) ---")
            aliasMismatches.forEach(::println)
        }
        if (branchMismatches.isNotEmpty()) {
            println("--- branch mismatches (${branchMismatches.size}) ---")
            branchMismatches.forEach(::println)
        }
        if (termsMismatches.isNotEmpty()) {
            println("--- union terms mismatches (${termsMismatches.size}) ---")
            termsMismatches.forEach(::println)
        }

        assertTrue(aliasMismatches.isEmpty() && branchMismatches.isEmpty() && termsMismatches.isEmpty(),
            "Lookup plan parity differs from the exported web plan")
        assertTrue(total > 100, "expected >100 golden queries, got $total")
    }
}

private fun formatPercent(numerator: Int, denominator: Int): String {
    if (denominator == 0) return "n/a"
    val tenths = kotlin.math.round(numerator.toDouble() / denominator * 1000).toInt()
    return "${tenths / 10}.${tenths % 10}%"
}
