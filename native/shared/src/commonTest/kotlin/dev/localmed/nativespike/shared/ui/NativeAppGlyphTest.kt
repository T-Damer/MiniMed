package dev.localmed.nativespike.shared.ui

import androidx.compose.ui.graphics.vector.PathParser
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class NativeAppGlyphTest {
    @Test fun everyWebGlyphHasUniqueIdentityAndComposeReadablePaths() {
        val glyphs = NativeAppGlyphName.entries
        assertEquals(glyphs.size, glyphs.map { it.webName }.toSet().size)
        assertTrue(glyphs.size >= 100)
        glyphs.forEach { glyph ->
            assertTrue(glyph.paths.isNotEmpty(), glyph.webName)
            glyph.paths.forEach { assertTrue(PathParser().parsePathString(it.data).toNodes().isNotEmpty(), glyph.webName) }
        }
    }
}
