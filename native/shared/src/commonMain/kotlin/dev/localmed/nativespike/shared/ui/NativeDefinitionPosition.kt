package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.core.NativeReaderRoute

fun nativeDefinitionSemanticPositionChanged(previous: NativeReaderRoute.Definition?, current: NativeReaderRoute.Definition): Boolean =
    previous == null || previous.target != current.target || previous.blockLinkId != current.blockLinkId ||
        previous.textOffsetCodepoints != current.textOffsetCodepoints

fun nativeDefinitionPageRange(offset: Int, total: Int, next: Int?): String =
    if (offset >= total) "В этой позиции блока нет текста · всего символов: $total"
    else "Диапазон блока: ${offset + 1}–${next ?: total} из $total"
