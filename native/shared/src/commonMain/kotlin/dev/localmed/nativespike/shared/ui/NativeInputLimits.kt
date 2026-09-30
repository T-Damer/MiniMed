package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.core.NATIVE_CATALOG_FILTER_MAX_LENGTH
import dev.localmed.nativespike.shared.core.NATIVE_SEARCH_QUERY_MAX_LENGTH

fun nativeSearchInputError(value: String): String? = when {
    value.contains('\u0000') -> "Запрос содержит недопустимый символ. Изменение не принято."
    value.length > NATIVE_SEARCH_QUERY_MAX_LENGTH -> "Максимальная длина запроса — $NATIVE_SEARCH_QUERY_MAX_LENGTH символов. Изменение не принято."
    else -> null
}

fun nativeCatalogInputError(value: String): String? = when {
    value.contains('\u0000') -> "Фильтр содержит недопустимый символ. Изменение не принято."
    value.length > NATIVE_CATALOG_FILTER_MAX_LENGTH -> "Максимальная длина фильтра — $NATIVE_CATALOG_FILTER_MAX_LENGTH символов. Изменение не принято."
    else -> null
}
