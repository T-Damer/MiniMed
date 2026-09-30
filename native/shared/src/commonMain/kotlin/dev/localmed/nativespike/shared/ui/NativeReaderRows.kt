package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.core.NativeReaderRoute
import dev.localmed.nativespike.shared.core.NativeSourceChunk
import dev.localmed.nativespike.shared.core.NativeSourceDocument
import dev.localmed.nativespike.shared.core.NativeSourceSection

sealed interface NativeReaderRow {
    val key: String
    data class Header(val section: NativeSourceSection) : NativeReaderRow { override val key get() = section.id }
    data class Source(val chunk: NativeSourceChunk) : NativeReaderRow { override val key get() = chunk.id }
}

fun nativeReaderRows(document: NativeSourceDocument): List<NativeReaderRow> =
    document.sections.sortedBy { it.orderIndex }.flatMap { section ->
        listOf(NativeReaderRow.Header(section)) + section.chunks.sortedBy { it.orderIndex }.map { NativeReaderRow.Source(it) }
    }

fun nativeReaderStartIndex(rows: List<NativeReaderRow>, snapshot: NativeReaderRoute.Document): Int {
    val saved = snapshot.chunkId?.let { id -> rows.indexOfFirst { it is NativeReaderRow.Source && it.chunk.id == id } }
    if (saved != null && saved >= 0) return saved
    val anchor = snapshot.target.anchor ?: return 0
    return rows.indexOfFirst { row ->
        when (row) {
            is NativeReaderRow.Header -> row.section.anchor == anchor
            is NativeReaderRow.Source -> row.chunk.anchor == anchor
        }
    }.coerceAtLeast(0)
}
