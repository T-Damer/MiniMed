package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.core.NativeDefinitionBlock
import dev.localmed.nativespike.shared.core.NativeDefinitionTarget
import dev.localmed.nativespike.shared.core.NativeReaderRoute
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NativeDefinitionPositionTest {
    @Test fun selectionAndUnicodePageAreDurableBeforeTextFinishesLoading() {
        val route = NativeReaderRoute.Definition(NativeDefinitionTarget("reference", "2026.9.30", "entry", "edition"))
        val state = NativeDefinitionReaderState(route)
        assertNull(state.position(0, 0))
        state.select(NativeDefinitionBlock("block-9", "chunk-9", "source", "definition", 9000))
        val selected = requireNotNull(state.position(2, 10))
        assertNull(state.text)
        assertTrue(nativeDefinitionSemanticPositionChanged(route, selected))
        assertFalse(nativeDefinitionSemanticPositionChanged(selected, requireNotNull(state.position(3, 80))))
        state.moveTo(4096)
        val page = requireNotNull(state.position(2, 0))
        assertNull(state.text)
        assertEquals(4096, page.textOffsetCodepoints)
        assertEquals("block-9", page.blockLinkId)
        assertTrue(nativeDefinitionSemanticPositionChanged(selected, page))
    }

    @Test fun endOfBlockHasNoInventedOrReversedRange() {
        assertEquals("Диапазон блока: 4097–5000 из 5000", nativeDefinitionPageRange(4096, 5000, null))
        assertEquals("В этой позиции блока нет текста · всего символов: 5000", nativeDefinitionPageRange(8192, 5000, null))
    }
}
