package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.core.NativeDefinitionCard

fun nativeIdentityCoverageLabel(coverage: String): String = when (coverage) {
    "needs-definition" -> "Название сохранено; определение ещё требуется."
    "mention-only" -> "Упоминание в источнике."
    else -> "Запись исходного материала."
}

fun nativeDefinitionEntryLabel(card: NativeDefinitionCard): String = when {
    card.kind == "abbreviation" -> "Расшифровка сокращения"
    card.textKind == "source-gloss" -> "Толкование из источника"
    card.textKind == "source-excerpt" -> "Фрагмент источника"
    card.textKind == "editorial-paraphrase" -> "Редакционная формулировка"
    else -> "Запись источника"
}

fun nativeDefinitionBlockLabel(role: String, card: NativeDefinitionCard): String = when (role) {
    "definition" -> when {
        card.kind == "abbreviation" -> "Расшифровка"
        card.textKind == "source-gloss" -> "Толкование"
        card.textKind == "editorial-paraphrase" -> "Формулировка"
        else -> "Определение"
    }
    "item" -> "Пункт"
    "context" -> "Контекст"
    "annotation" -> "Сведения об источнике"
    else -> "Исходный блок"
}
