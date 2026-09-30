package dev.localmed.nativespike.shared.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class NativeIdentityBoundaryTest {
    @Test
    fun exactNamesUseEcmaWhitespaceWithoutDeletingPunctuationOrStopWords() {
        assertEquals("a-b (и)",normalizeNativeIdentityName("\u3000Ａ-B\t(И)\ufeff"))
        assertEquals("е и",normalizeNativeIdentityName("Ё\u00a0\u1680\u2007\u2028\u2029\u202f\u205fИ"))
        assertEquals("и\u0085а",normalizeNativeIdentityName("И\u0085А"))
        assertEquals("и",normalizeNativeIdentityName("И"))
        assertEquals("а б",normalizeNativeIdentityName("А\u000b\u000c\r\nБ"))
    }
    @Test
    fun SavedDefinitionRouteRequiresItsOwnCursorAndCodepointOffset() {
        val target=NativeDefinitionTarget("source.reference","2026.9.30","entry","edition")
        validateReaderRoute(NativeReaderRoute.Definition(target,"entry.reference.000001",4096,1,2))
        assertFailsWith<IllegalArgumentException> { validateReaderRoute(NativeReaderRoute.Definition(target,"other.reference.000001")) }
        assertFailsWith<IllegalArgumentException> { validateReaderRoute(NativeReaderRoute.Definition(target,textOffsetCodepoints=262145)) }
    }
}
