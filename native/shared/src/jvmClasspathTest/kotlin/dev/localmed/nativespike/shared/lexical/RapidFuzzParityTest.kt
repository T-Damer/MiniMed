package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.golden.readRapidfuzzParityFixture
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Checks the Kotlin port of `rapidfuzz.ts`'s OSA/Levenshtein distance metrics
 * (lexical/RapidFuzz.kt) against `rapidfuzz-parity.fixture.json` — 1741 real RapidFuzz 3.14.6
 * (Python) reference cases, copied verbatim from
 * `packages/search-lexical/src/rapidfuzz-parity.fixture.json`. This is an *independent*
 * correctness check: `rapidfuzz.ts`'s distances are not exercised by `search-golden.json`'s
 * `aliasMatches` (`aliases.ts`'s own fuzzy matching uses `normalize.ts`'s separate bounded
 * `levenshteinDistance` — see `text/TextNormalization.kt`'s `isCloseToken`), required by the
 * coordinator alongside normalize+aliases for stage 2 sub-stage A regardless.
 *
 * Duplicated in `iosTest`, not `commonTest`, for the same wasmJs-fixture-access reason as
 * `AliasParityTest`.
 */
class RapidFuzzParityTest {
    @Test
    fun osa_and_levenshtein_match_the_rapidfuzz_reference_values() {
        val fixture = Json.parseToJsonElement(readRapidfuzzParityFixture()).jsonObject
        val cases = fixture.getValue("cases").jsonArray
        assertTrue(cases.size > 1000, "expected >1000 fixture cases, got ${cases.size}")

        var mismatches = 0
        val examples = mutableListOf<String>()
        for (entry in cases) {
            val row = entry.jsonObject
            val id = row.getValue("id").jsonPrimitive.content
            val a = row.getValue("a").jsonPrimitive.content
            val b = row.getValue("b").jsonPrimitive.content
            val expectedOsa = row.getValue("osaDistance").jsonPrimitive.content.toInt()
            val expectedLevenshtein = row.getValue("levenshteinDistance").jsonPrimitive.content.toInt()

            // The dispatch-level API (bit-parallel for <=64 chars, which every fixture case is).
            val actualOsa = OSA.distance(a, b)
            val actualLevenshtein = Levenshtein.distance(a, b)
            // The row-wise DP oracle directly, so a bit-parallel-only bug can't hide behind a
            // coincidentally-correct dispatch result.
            val dpOsa = RapidFuzzInternal.osaDp(a, b)
            val dpLevenshtein = RapidFuzzInternal.levenshteinDp(a, b)

            if (actualOsa != expectedOsa || actualLevenshtein != expectedLevenshtein ||
                dpOsa != expectedOsa || dpLevenshtein != expectedLevenshtein
            ) {
                mismatches += 1
                if (examples.size < 20) {
                    examples.add(
                        "[$id] \"$a\" vs \"$b\": expected osa=$expectedOsa lev=$expectedLevenshtein, " +
                            "actual osa=$actualOsa(dp=$dpOsa) lev=$actualLevenshtein(dp=$dpLevenshtein)",
                    )
                }
            }
        }

        println("=== RapidFuzz parity report ===")
        println("cases compared: ${cases.size}, mismatches: $mismatches")
        examples.forEach(::println)
        assertEquals(0, mismatches, "RapidFuzz port diverges from the reference fixture on $mismatches/${cases.size} cases")
    }
}
