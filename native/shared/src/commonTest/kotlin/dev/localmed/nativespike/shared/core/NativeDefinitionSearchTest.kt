package dev.localmed.nativespike.shared.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NativeDefinitionSearchTest {
    private fun plan(query: String)=assertNotNull(planDefinitionDescription(query))
    private fun candidate(id: String,text: String)=DefinitionDescriptionCandidate(id,text,0)

    @Test
    fun questionFramingPreservesCompleteLiteralSubjectAndBoundedNameRepair() {
        assertEquals("тест с уточнением",definitionQuestionSubject("Что такое «тест с уточнением»？"))
        assertEquals("И",definitionQuestionSubject("\ufeffЧто\u00a0такое И?"))
        assertNull(definitionQuestionSubject("\u0085Что такое И?"))
        assertNull(definitionQuestionSubject("что такое "+"x".repeat(513)))
        assertTrue(definitionNameTranspositions("термин").contains("темрин"))
        for(name in listOf("А00","abcd","латинa","12345678")) assertTrue(definitionNameTranspositions(name).isEmpty())
        assertTrue(definitionNameTranspositions("abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuv").size<=47)
        assertTrue(isDefinitionNavigationOnly("Найди термин!"))
    }

    @Test
    fun polarityIsClauseLocalAndAdditiveNotOnlyIsNotAbsence() {
        assertEquals(listOf("present"),rankDefinitionDescriptions(plan("запахи ощущаются"),listOf(candidate("absent","Запахи не ощущаются."),candidate("present","Запахи ощущаются."))).map { it.id })
        assertTrue(plan("не только зрительное восприятие, но и слуховое восприятие").terms.all { !it.absent })
        val contrast=plan("боль отсутствует однако движение сохранено")
        assertTrue(contrast.terms.single { it.stem=="боль" }.absent)
        assertTrue(!contrast.terms.single { it.stem=="движ" }.absent)
        assertNull(planDefinitionDescription("боль есть, боль отсутствует"))
    }

    @Test
    fun repeatedEvidenceAndDisjointPassagesCannotManufactureCoverage() {
        val query=plan("короткое движение мышцы")
        val repeated=candidate("a","Короткое движение мышцы.")
        val rows=listOf(repeated,candidate("b","Короткое движение."),candidate("c","Изменение длины мышцы."))
        assertEquals(rankDefinitionDescriptions(query,rows),rankDefinitionDescriptions(query,rows+repeated+repeated))
        val later=rankDefinitionDescriptions(query,listOf(candidate("a","Измеряется длина мышцы."),repeated)).single()
        assertEquals(3,later.matched);assertEquals(3,later.total)
        assertTrue(rankDefinitionDescriptions(plan("красный длинный круглый объект"),listOf(candidate("a","Красный объект."),candidate("a","Длинный круглый."))).isEmpty())
    }

    @Test
    fun evidenceRepairsOnlyLongAdjacentLetterSwapsAndEnforcesUnicodeBudget() {
        assertEquals(3,rankDefinitionDescriptions(plan("кратковременные сокращнеия мышцы"),listOf(candidate("a","Кратковременные сокращения мышцы."))).single().matched)
        assertTrue(rankDefinitionDescriptions(plan("число 12345678"),listOf(candidate("a","Число 12346578."))).isEmpty())
        assertTrue(rankDefinitionDescriptions(plan("боль тела"),listOf(candidate("a","Моль тела."))).isEmpty())
        val query=plan("короткое движение")
        assertFailsWith<IllegalArgumentException> { rankDefinitionDescriptions(query,List(193) { candidate("a","x") }) }
        assertFailsWith<IllegalArgumentException> { rankDefinitionDescriptions(query,listOf(candidate("a","\ud83d\ude00".repeat(4097)))) }
        assertTrue(rankDefinitionDescriptions(query,listOf(candidate("a","\ud83d\ude00".repeat(4096)))).isEmpty())
    }
}
