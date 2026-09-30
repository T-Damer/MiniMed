package dev.localmed.nativespike.shared.ui

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class NativeCatalogFilterTest {
    @Test fun sourceTitlesMatchCaseAndYoWithoutDroppingShortWords() {
        val indexed = nativeCatalogFilterText("Нормативные документы РФ: педиатрия", "minimed.regulatory.pediatrics.ru")
        assertTrue(nativeCatalogFilterMatches(indexed, nativeCatalogFilterTerms("  РФ   ПЕДИАТРИЯ ")))
        assertFalse(nativeCatalogFilterMatches(indexed, nativeCatalogFilterTerms("РФ взрослые")))
        assertTrue(nativeCatalogFilterMatches(nativeCatalogFilterText("Лёгочная гипертензия у детей", "source.child"), nativeCatalogFilterTerms("легочная у детей")))
        assertFalse(nativeCatalogFilterMatches(nativeCatalogFilterText("Лёгочная гипертензия у детей", "source.child"), nativeCatalogFilterTerms("у взрослых")))
    }

    @Test fun missingCatalogNamesRemainFindableByExactIdentifier() {
        val indexed = nativeCatalogFilterText(null, "regulatory.rf.minzdrav.192n-2025")
        assertTrue(nativeCatalogFilterMatches(indexed, nativeCatalogFilterTerms("192n-2025")))
        assertFalse(nativeCatalogFilterMatches(indexed, nativeCatalogFilterTerms("211n-2025")))
        assertTrue(nativeCatalogFilterMatches(indexed, nativeCatalogFilterTerms(" \n ")))
    }
}
