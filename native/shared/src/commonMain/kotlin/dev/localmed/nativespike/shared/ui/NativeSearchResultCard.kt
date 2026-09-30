package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.localmed.nativespike.shared.core.NativeDocumentTarget
import dev.localmed.nativespike.shared.designsystem.NativeDimensions
import dev.localmed.nativespike.shared.designsystem.NativeResultGroup
import dev.localmed.nativespike.shared.designsystem.NativeResultSnippet
import dev.localmed.nativespike.shared.model.DocumentKind
import dev.localmed.nativespike.shared.model.SearchResultGroup
import dev.localmed.nativespike.shared.text.snippetSegments

/** Retain exact text, source targets and half-open character offsets from retrieval. */
internal fun nativeResultSnippets(
    group: SearchResultGroup,
    onOpen: (String, String, String?, NativeDocumentTarget?) -> Unit,
): List<NativeResultSnippet> = group.items.map { item ->
    snippetSegments(item.snippet, item.highlightedRanges)
    NativeResultSnippet(
        stamp = null,
        path = item.sectionPath,
        text = item.snippet,
        highlights = item.highlightedRanges.map { it.start until it.end },
        onOpen = { onOpen(group.documentId, group.documentTitle, item.anchor, item.target) },
    )
}

@Composable
internal fun NativeSearchResultCard(
    group: SearchResultGroup,
    index: Int,
    onOpenDocument: (String, String, String?, NativeDocumentTarget?) -> Unit,
) {
    val glyph = when (group.documentKind) {
        DocumentKind.MEDICATION -> NativeAppGlyphName.Prescription
        DocumentKind.CLINICAL_RECOMMENDATION -> NativeAppGlyphName.BookOpen
        DocumentKind.LEGAL -> NativeAppGlyphName.Scales
        DocumentKind.CALCULATOR -> NativeAppGlyphName.Calculator
        DocumentKind.ASSESSMENT -> NativeAppGlyphName.ListChecks
        else -> NativeAppGlyphName.Notes
    }
    NativeResultGroup(
        index = index + 1,
        kindLabel = group.documentKind.label,
        title = group.documentTitle,
        snippets = nativeResultSnippets(group, onOpenDocument),
        onOpen = {
            val item = group.items.firstOrNull()
            onOpenDocument(group.documentId, group.documentTitle, item?.anchor, item?.target)
        },
        moreTitle = { count ->
            val noun = if (count % 100 in 11..14) "фрагментов" else when (count % 10) {
                1 -> "фрагмент"
                2, 3, 4 -> "фрагмента"
                else -> "фрагментов"
            }
            "Ещё $count $noun"
        },
        kindIcon = { tint -> NativeAppGlyph(glyph, Modifier.size(NativeDimensions.space4), tint) },
    )
}
