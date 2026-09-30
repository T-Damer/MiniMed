package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.text.normalizeSurfaceText

/** Prepared once per catalog row, without changing its displayed source title. */
fun nativeCatalogFilterText(title: String?, id: String): String =
    normalizeSurfaceText(listOfNotNull(title, id).joinToString(" "))

fun nativeCatalogFilterTerms(query: String): List<String> =
    normalizeSurfaceText(query).split(' ').filter { it.isNotBlank() }

fun nativeCatalogFilterMatches(text: String, terms: List<String>): Boolean =
    terms.all { text.contains(it) }
