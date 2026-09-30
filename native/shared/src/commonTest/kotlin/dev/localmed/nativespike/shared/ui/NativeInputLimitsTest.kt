package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.core.NATIVE_CATALOG_FILTER_MAX_LENGTH
import dev.localmed.nativespike.shared.core.NATIVE_SEARCH_QUERY_MAX_LENGTH
import dev.localmed.nativespike.shared.core.NativeSearchSnapshot
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class NativeInputLimitsTest {
    @Test fun validLongQuerySurvivesAndRejectedInputNeverReplacesTheDurableDraft() {
        val state = NativeSearchUiState(NativeSearchSnapshot("исходный запрос", 2, 194))
        val accepted = "а".repeat(NATIVE_SEARCH_QUERY_MAX_LENGTH)
        state.updateQuery(accepted)
        assertNull(state.inputError)
        assertEquals(accepted, state.snapshot().query)
        state.updateQuery(accepted + "а")
        assertNotNull(state.inputError)
        assertEquals(accepted, state.snapshot().query)
        state.updateQuery("новый\u0000запрос")
        assertNotNull(state.inputError)
        assertEquals(accepted, state.snapshot().query)
        state.updateQuery("следующий запрос")
        assertNull(state.inputError)
        assertEquals("следующий запрос", state.snapshot().query)
    }

    @Test fun catalogFilterUsesItsOwnBoundWithoutTruncation() {
        assertNull(nativeCatalogInputError("а".repeat(NATIVE_CATALOG_FILTER_MAX_LENGTH)))
        assertNotNull(nativeCatalogInputError("а".repeat(NATIVE_CATALOG_FILTER_MAX_LENGTH + 1)))
        assertNotNull(nativeCatalogInputError("source\u0000id"))
    }
}
