package dev.localmed.nativespike.shared.search

import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.golden.testCoreDbPath
import dev.localmed.nativespike.shared.lexical.buildQueryDocumentIndex
import dev.localmed.nativespike.shared.lexical.createAliasExpander
import dev.localmed.nativespike.shared.lexical.createMedicationSpellingMatcher
import dev.localmed.nativespike.shared.lexical.filterQueryAliases
import dev.localmed.nativespike.shared.lexical.runLookupPipelineGroups
import dev.localmed.nativespike.shared.lexical.sortAliasesLikeMultiMedicalStore
import dev.localmed.nativespike.shared.model.DocumentKind
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class LookupEngineKindTest {
    @Test
    fun actual_lookup_cards_preserve_classified_clinical_and_medication_pointer_kinds() = runBlocking {
        val database = NativeSearchDatabase(testCoreDbPath())
        database.open()
        try {
            val engine = LookupEngine(database)
            // The engine owns startup DB reads; wait before the independent pipeline comparison.
            engine.awaitReady()
            val aliases = filterQueryAliases(sortAliasesLikeMultiMedicalStore(database.listAliases()))
            val index = buildQueryDocumentIndex(database)
            val expander = createAliasExpander(aliases)
            val spelling = createMedicationSpellingMatcher(aliases)
            for ((query, expectedKind, label) in listOf(
                Triple("пневмония", DocumentKind.CLINICAL_RECOMMENDATION, "Клиническая рекомендация"),
                Triple("амоксициллин", DocumentKind.MEDICATION, "Препарат"),
            )) {
                val ranked = runLookupPipelineGroups(query, aliases, database, index, 20, expander, spelling)
                val ui = assertNotNull(engine.search(query))
                assertEquals(ranked.map { it.documentId }, ui.groups.map { it.documentId })
                for ((source, card) in ranked.zip(ui.groups)) {
                    assertEquals(DocumentKind.fromClassifiedKind(source.documentKind), card.documentKind, source.documentId)
                    assertEquals(source.results.take(3).map { it.anchor }, card.items.map { it.anchor }, source.documentId)
                }
                val pointerIds = ranked.filter { group ->
                    DocumentKind.fromClassifiedKind(group.documentKind) == expectedKind &&
                        group.results.any { it.sourceType == "core_catalog_pointer" }
                }.map { it.documentId }.toSet()
                assertTrue(pointerIds.isNotEmpty(), "The real corpus must exercise a classified source pointer")
                for (card in ui.groups.filter { it.documentId in pointerIds }) {
                    assertEquals(expectedKind, card.documentKind, card.documentId)
                    assertEquals(label, card.documentKind.label)
                }
            }
        } finally {
            database.close()
        }
    }
}
