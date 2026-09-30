package dev.localmed.nativespike.shared.ui

private fun russianCount(count: Int, one: String, few: String, many: String): String {
    val ending = if (count % 100 in 11..14) many else when (count % 10) { 1 -> one; 2, 3, 4 -> few; else -> many }
    return "$count $ending"
}

fun nativeCatalogCounts(documents: Int, versions: Int): String =
    "${russianCount(documents, "документ", "документа", "документов")} · ${russianCount(versions, "редакция", "редакции", "редакций")}"

fun nativeCatalogStatus(status: String): String = when (status) {
    "active" -> "активная запись"
    "historical" -> "историческая запись"
    "superseded" -> "заменённая редакция"
    else -> status
}
