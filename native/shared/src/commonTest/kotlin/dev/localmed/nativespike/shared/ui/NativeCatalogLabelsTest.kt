package dev.localmed.nativespike.shared.ui

import kotlin.test.Test
import kotlin.test.assertEquals

class NativeCatalogLabelsTest {
    @Test fun countersNameDocumentsAndExactEditionsWithRussianPluralForms() {
        val expected = mapOf(0 to "0 документов · 0 редакций", 1 to "1 документ · 1 редакция",
            2 to "2 документа · 2 редакции", 5 to "5 документов · 5 редакций", 11 to "11 документов · 11 редакций",
            14 to "14 документов · 14 редакций", 21 to "21 документ · 21 редакция", 22 to "22 документа · 22 редакции")
        expected.forEach { (count, label) -> assertEquals(label, nativeCatalogCounts(count, count)) }
        assertEquals("1 документ · 3 редакции", nativeCatalogCounts(1, 3))
    }
    @Test fun sourceStatusRetainsCatalogMeaning() {
        assertEquals("активная запись", nativeCatalogStatus("active"))
        assertEquals("историческая запись", nativeCatalogStatus("historical"))
        assertEquals("заменённая редакция", nativeCatalogStatus("superseded"))
    }
}
