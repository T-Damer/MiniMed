package dev.localmed.nativespike.shared

import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.golden.readGoldenFixture
import dev.localmed.nativespike.shared.golden.testCoreDbPath
import dev.localmed.nativespike.shared.lexical.*
import kotlinx.serialization.json.*
import kotlin.test.assertTrue

/** A strict gate shared by desktop and iOS, including empty outcomes and readable source targets. */
fun assertLookupParity() {
    val golden = Json.parseToJsonElement(readGoldenFixture()).jsonObject
    val queries = golden.getValue("queries").jsonArray
    val limit = golden.getValue("groupLimit").jsonPrimitive.content.toInt()
    val db = NativeSearchDatabase(testCoreDbPath())
    db.open()
    try {
        val aliases = filterQueryAliases(sortAliasesLikeMultiMedicalStore(db.listAliases()))
        assertTrue(aliases.isNotEmpty())
        val index = buildQueryDocumentIndex(db)
        val expander = createAliasExpander(aliases)
        val medicationMatcher = createMedicationSpellingMatcher(aliases)
        val mismatches = mutableListOf<String>()
        var compared = 0
        var exactGroups = 0
        var exactPassages = 0
        for (entry in queries) {
            val row = entry.jsonObject
            val sourceId = row.getValue("sourceId").jsonPrimitive.content
            if (row["error"] != null) {
                mismatches.add("$sourceId: export failed")
                continue
            }
            compared++
            val expected = row.getValue("groups").jsonArray.map { it.jsonObject }
            val actual = runLookupPipelineGroups(row.getValue("query").jsonPrimitive.content, aliases, db, index, limit, expander, medicationMatcher)
            val expectedIds = expected.map { it.getValue("documentId").jsonPrimitive.content }
            val actualIds = actual.map { it.documentId }
            var groupsOk = expectedIds == actualIds
            var passagesOk = groupsOk
            if (!groupsOk) mismatches.add("$sourceId: group order/selection expected=$expectedIds actual=$actualIds")
            for ((position, group) in actual.withIndex()) {
                val saved = expected.firstOrNull { it.getValue("documentId").jsonPrimitive.content == group.documentId } ?: continue
                fun string(name: String) = saved[name]?.jsonPrimitive?.contentOrNull
                if (string("targetDocumentId") != group.targetDocumentId || string("documentKind") != group.documentKind ||
                    string("contentKind") != group.contentKind || kotlin.math.abs(saved.getValue("bestScore").jsonPrimitive.double - group.bestScore) > 1e-6) {
                    groupsOk = false
                    mismatches.add("$sourceId/$position: group target/kind/content/score mismatch")
                }
                val passages = saved.getValue("results").jsonArray.map { it.jsonObject }
                if (passages.map { it.getValue("chunkId").jsonPrimitive.content } != group.results.map { it.chunkId }) {
                    passagesOk = false
                    mismatches.add("$sourceId/$position: passage order/selection mismatch")
                }
                for (result in group.results) {
                    val passage = passages.firstOrNull { it.getValue("chunkId").jsonPrimitive.content == result.chunkId } ?: continue
                    val expectedRanges = passage.getValue("highlightedRanges").jsonArray.map {
                        val range = it.jsonObject
                        range.getValue("start").jsonPrimitive.int to range.getValue("end").jsonPrimitive.int
                    }
                    val same = passage.getValue("documentVersionId").jsonPrimitive.content == result.documentVersionId &&
                        passage.getValue("sectionId").jsonPrimitive.content == result.sectionId &&
                        passage.getValue("anchor").jsonPrimitive.content == result.anchor &&
                        passage.getValue("snippet").jsonPrimitive.content == result.snippet &&
                        expectedRanges == result.highlightedRanges.map { it.start to it.end } &&
                        passage.getValue("matchedTerms").jsonArray.map { it.jsonPrimitive.content } == result.matchedTerms &&
                        kotlin.math.abs(passage.getValue("finalScore").jsonPrimitive.double - result.finalScore) <= 1e-6
                    if (!same) {
                        passagesOk = false
                        mismatches.add("$sourceId/${result.chunkId}: excerpt/ranges/reader identity/terms/score mismatch")
                    }
                }
            }
            if (groupsOk) exactGroups++
            if (passagesOk) exactPassages++
        }
        println("Native lookup parity: groups=$exactGroups/$compared, passages=$exactPassages/$compared, mismatches=${mismatches.size}")
        mismatches.take(40).forEach(::println)
        assertTrue(compared == queries.size && compared > 100, "Every exported query must be compared")
        assertTrue(mismatches.isEmpty(), "Native lookup differs from web (${mismatches.size} findings):\n${mismatches.take(40).joinToString("\n")}")
    } finally {
        db.close()
    }
}
