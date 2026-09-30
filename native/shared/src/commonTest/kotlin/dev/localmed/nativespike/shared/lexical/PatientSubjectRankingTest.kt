package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.RankedGroup
import dev.localmed.nativespike.shared.model.RankedResult
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PatientSubjectRankingTest {
    private fun group(id: String, title: String, snippet: String, score: Double, matched: List<String> = emptyList()) =
        RankedGroup(id, title, score, listOf(RankedResult(id, id, "reference", title, null, "other", emptyList(), matched, score, snippet = snippet)))

    @Test
    fun opposite_age_source_scope_cannot_outweigh_matching_or_neutral_subjects() {
        for ((qualifier, matching, opposite) in listOf(
            Triple("ребенка", "детей", "взрослых"),
            Triple("детей", "детей", "взрослых"),
            Triple("взрослого", "взрослых", "детей"),
        )) {
            val query = "Вирусный энцефалит у $qualifier"
            val groups = listOf(
                group("opposite", "Вирусный энцефалит у $opposite", query, 100.0),
                group("wrong-topic", "Травмы у $matching", "Осмотр $qualifier", 200.0, listOf("вирусный", "энцефалит")),
                group("matching", "Вирусный энцефалит у $matching", "Описание источника", 0.1),
                group("generic", "Вирусный энцефалит", "Описание источника", 0.5),
                group("combined", "Вирусный энцефалит у детей и взрослых", "Описание источника", 0.3),
            )
            val ranked = rankSearchGroupsByQuery(groups, query, emptyMap()).map { it.documentId }
            for (compatible in listOf("generic", "combined", "matching")) {
                assertTrue(ranked.indexOf(compatible) < ranked.indexOf("opposite"), qualifier)
            }
            assertTrue(ranked.indexOf("opposite") < ranked.indexOf("wrong-topic"), qualifier)
            for (neutralQuery in listOf("энцефалит", "энцефалит у детей и взрослых")) {
                assertEquals("opposite", rankSearchGroupsByQuery(groups.filter { it.documentId != "wrong-topic" }, neutralQuery, emptyMap()).first().documentId)
            }
        }
    }

    @Test
    fun each_patient_qualifier_requires_subject_in_the_title_or_actual_excerpt() {
        for (qualifier in listOf("ребенок", "ребенка", "дети", "детский", "взрослый", "взрослого", "мужчина", "женщина", "мужской", "женский")) {
            val falseEvidence = group("patient-only", "Осмотр пациента", "Описание: $qualifier", 30.0, listOf("пневмония", qualifier))
            val source = group("source", "Справочник", "Пневмония: материал источника", 0.5)
            val ranked = rankSearchGroupsByQuery(listOf(falseEvidence, source), "пневмония $qualifier", emptyMap())
            assertEquals("source", ranked.first().documentId, qualifier)
            val titleSource = group("title-source", "Пневмония", "Описание источника", 0.5)
            assertEquals("title-source", rankSearchGroupsByQuery(listOf(falseEvidence, titleSource),
                "пневмония $qualifier", emptyMap()).first().documentId, qualifier)
        }
    }

    @Test
    fun source_token_coverage_does_not_count_the_same_token_twice() {
        assertEquals(0.24, queryGroupRelevanceBoost("кашель мокрота мокроты", "кашель мокрот"))
    }

    @Test
    fun matched_terms_and_section_paths_do_not_create_a_source_phrase() {
        val falsePhrase = group("matched-only", "Справочник", "Материал об осмотре", 10.0, listOf("острая", "вирусная", "пневмония"))
        val pathOnly = falsePhrase.copy(results = falsePhrase.results.map { it.copy(sectionPath = listOf("Острая вирусная пневмония")) })
        val source = group("source", "Справочник", "Острая вирусная пневмония", 0.5)
        assertEquals("source", rankSearchGroupsByQuery(listOf(pathOnly, source), "острая вирусная пневмония", emptyMap()).first().documentId)
    }
}
