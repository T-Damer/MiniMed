package dev.localmed.nativespike.shared.reader

import dev.localmed.nativespike.shared.designsystem.blockIndexAt
import dev.localmed.nativespike.shared.designsystem.listIndexOf
import kotlin.test.Test
import kotlin.test.assertEquals

class NativeDocumentItemsTest {
    @Test
    fun sectionTitlesTakeASpacerItemAndIndicesRoundTrip() {
        // Blocks: h1, p, h2, p, h2, p → items: h1, p, space, h2, p, space, h2, p.
        val document = NativeMarkdownImporter.import("# A\n\nx\n\n## B\n\ny\n\n## C\n\nz")
        assertEquals(listOf(0, 1, 3, 4, 6, 7), document.blocks.indices.map { document.listIndexOf(it) })
        assertEquals(listOf(0, 1, 2, 2, 3, 4, 4, 5), (0..7).map { document.blockIndexAt(it) })
        for (block in document.blocks.indices) assertEquals(block, document.blockIndexAt(document.listIndexOf(block)))
    }
}
