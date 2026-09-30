package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.core.NativeDefinitionCard
import kotlin.test.Test
import kotlin.test.assertEquals

class NativeReferenceLabelsTest {
    private fun card(kind: String, textKind: String) = NativeDefinitionCard("source.term", "Название источника", kind, "definition", textKind, 1)

    @Test fun editorialWordingAndDictionaryGlossRetainDeclaredMeaning() {
        val editorial = card("diagnosis", "editorial-paraphrase")
        assertEquals("Редакционная формулировка", nativeDefinitionEntryLabel(editorial))
        assertEquals("Формулировка", nativeDefinitionBlockLabel("definition", editorial))
        val gloss = card("term", "source-gloss")
        assertEquals("Толкование из источника", nativeDefinitionEntryLabel(gloss))
        assertEquals("Толкование", nativeDefinitionBlockLabel("definition", gloss))
        assertEquals("Фрагмент источника", nativeDefinitionEntryLabel(card("term", "source-excerpt")))
    }

    @Test fun abbreviationAndMentionDoNotBecomeApprovedClinicalDefinitions() {
        val abbreviation = card("abbreviation", "source-excerpt")
        assertEquals("Расшифровка сокращения", nativeDefinitionEntryLabel(abbreviation))
        assertEquals("Расшифровка", nativeDefinitionBlockLabel("definition", abbreviation))
        assertEquals("Сведения об источнике", nativeDefinitionBlockLabel("annotation", abbreviation))
        assertEquals("Упоминание в источнике.", nativeIdentityCoverageLabel("mention-only"))
        assertEquals("Название сохранено; определение ещё требуется.", nativeIdentityCoverageLabel("needs-definition"))
    }
}
