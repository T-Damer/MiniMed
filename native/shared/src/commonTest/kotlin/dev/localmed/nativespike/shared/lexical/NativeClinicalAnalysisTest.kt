package dev.localmed.nativespike.shared.lexical

import dev.localmed.nativespike.shared.model.AliasRecord
import dev.localmed.nativespike.shared.model.QueryCalculation
import dev.localmed.nativespike.shared.model.QueryFactKind
import dev.localmed.nativespike.shared.model.SearchIntentKind
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NativeClinicalAnalysisTest {
    private val medication=listOf(AliasRecord("medication.1","ибупрофен","ибупрофен","medication",1.0))

    @Test
    fun factsUseOriginalUtf16RangesAndEcmaWhitespaceWithoutUnicodeDigitInference() {
        val query="\ud83d\ude00 Мальчику\u00a012\u2009лет, температура\u202f39,5"
        val plan=analyzeClinicalQuery(query,emptyList(),false)
        val sex=plan.analysis.facts.single { it.kind==QueryFactKind.SEX }
        assertEquals(3,sex.range.start)
        val age=plan.analysis.facts.single { it.kind==QueryFactKind.AGE }
        assertEquals("12 лет",age.normalizedValue)
        val temperature=plan.analysis.facts.single { it.kind==QueryFactKind.TEMPERATURE }
        assertEquals("39.5",temperature.normalizedValue)
        assertTrue(plan.analysis.facts.all { it.range.start>=0 && it.range.end<=query.length && query.substring(it.range.start,it.range.end).trim()==it.value })
        assertTrue(analyzeClinicalQuery("ребенок\u008512 лет",emptyList(),false).analysis.facts.none { it.kind==QueryFactKind.AGE })
        assertTrue(analyzeClinicalQuery("ребенок ١٢ лет",emptyList(),false).analysis.facts.none { it.kind==QueryFactKind.AGE })
    }

    @Test
    fun compoundAgeAndGestationAreProtectedFromIllnessDuration() {
        val compound=analyzeClinicalQuery("Ребенок 1 год 6 месяцев, болеет 2 дня",emptyList(),false).analysis
        assertEquals(listOf("18 месяцев"),compound.clinicalContext.age.map { it.normalizedValue })
        assertEquals(listOf("2 дня"),compound.clinicalContext.duration.map { it.normalizedValue })
        val gestation=analyzeClinicalQuery("Беременность 12 недель, жалобы 3 дня",emptyList(),false).analysis
        assertEquals(listOf("12 недель"),gestation.clinicalContext.gestationalAge.map { it.normalizedValue })
        assertEquals(listOf("3 дня"),gestation.clinicalContext.duration.map { it.normalizedValue })
        assertEquals("18 месяцев",analyzeClinicalQuery("Полтора года",emptyList(),false).analysis.clinicalContext.age.single().normalizedValue)
        assertEquals("неонатальный период",analyzeClinicalQuery("Новорожденная",emptyList(),false).analysis.clinicalContext.age.single().normalizedValue)
    }

    @Test
    fun negativeFindingsNeverReenterAliasIntentOrCanonicalSymptomBranches() {
        for(query in listOf("Кашля нет; температура 39", "Нет кашля, температура 39", "Кашля не наблюдается; температура 39")) {
            val plan=analyzeClinicalQuery(query,emptyList(),false)
            assertTrue(plan.analysis.clinicalContext.negativeFindings.isNotEmpty())
            assertTrue(plan.branches.flatMap { it.terms }.none { it.startsWith("каш") })
            assertTrue(plan.analysis.clinicalContext.positiveFindings.none { it.normalizedValue.contains("каш") })
        }
        val known=listOf(AliasRecord("symptom.1","кашель","кашля","symptom",1.0))
        assertTrue(analyzeClinicalQuery("Нет кашля; жалуется на боль",known,false).analysis.facts.none { it.kind==QueryFactKind.SYMPTOM && it.normalizedValue=="кашель" })
    }

    @Test
    fun doseProposalsRequireNamedMedicationAndExcludeInformationPastIntakeAndOverdose() {
        assertIs<QueryCalculation.MedicationDose>(analyzeClinicalQuery("ибупрофен ребенку 5 лет",medication,false).analysis.calculation)
        assertIs<QueryCalculation.MedicationDose>(analyzeClinicalQuery("рассчитать дозу ибупрофен",medication,false).analysis.calculation)
        assertNull(analyzeClinicalQuery("рассчитать дозу препарата ребенку 5 лет",emptyList(),false).analysis.calculation)
        for(prefix in listOf("инструкция", "противопоказания", "побочные эффекты", "аналоги", "состав", "можно ли", "передозировка", "уже принимал", "после приема", "дозированный")) {
            assertNull(analyzeClinicalQuery("$prefix ибупрофен ребенку 5 лет",medication,false).analysis.calculation,"Calculation exclusion failed")
        }
        assertNull(analyzeClinicalQuery("Ребенок 5 лет, ибупрофен не принимал",medication,false).analysis.calculation)
        assertIs<QueryCalculation.InfusionVolume>(analyzeClinicalQuery("Объем инфузии ребенку 5 лет",emptyList(),false).analysis.calculation)
        assertNull(analyzeClinicalQuery("Инструкция объем инфузии ребенку 5 лет",emptyList(),false).analysis.calculation)
        assertNull(analyzeClinicalQuery("Уже введен объем инфузии ребенку 5 лет",emptyList(),false).analysis.calculation)
    }

    @Test
    fun structuredPresentationRetainsSourceValuesUnitsAndClausePolarity() {
        val context=analyzeClinicalQuery("Масса семьдесят кг, в/в 25 мг/5 мл 2 раза в день; аллергии нет; без почечной недостаточности",emptyList(),false).analysis.clinicalContext
        assertEquals("70 кг",context.weight.single().normalizedValue)
        assertEquals("внутривенно",context.route.single().normalizedValue)
        assertEquals("25 мг/5 мл",context.strength.single().normalizedValue)
        assertEquals("2 раза в сутки",context.frequency.single().normalizedValue)
        assertTrue(context.allergies.single().polarity.wire=="negative")
        assertTrue(context.organFunction.single().polarity.wire=="negative")
    }

    @Test
    fun questionIntentSuggestionsAndWarningsStayTypedAndBounded() {
        assertEquals(SearchIntentKind.DISEASE_REFERENCE,classifyMedicalQueryIntent("Что такое диабет").primary)
        assertEquals(SearchIntentKind.DIAGNOSIS,classifyMedicalQueryIntent("Как отличить менингит от энцефалита").primary)
        val plan=analyzeClinicalQuery("Кажется менингит или энцефалит",emptyList())
        assertTrue(plan.analysis.warnings.isNotEmpty())
        assertTrue(plan.analysis.suggestions.size<=7)
        assertTrue(plan.analysis.suggestions.zipWithNext().all { it.first.priority>=it.second.priority })
        assertTrue(plan.analysis.suggestions.map { it.id }.distinct().size==plan.analysis.suggestions.size)
        assertTrue(analyzeClinicalQuery("Кажется менингит или энцефалит",emptyList(),false).analysis.suggestions.isEmpty())
    }
}
