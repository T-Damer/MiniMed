package dev.localmed.nativespike.shared.tools

/** Separate source-ordered tool inventory; it never changes document ranking. */
enum class NativeToolKind(val wire: String) { Calculator("calculator"), Assessment("assessment") }
data class NativeToolCatalogMatch(val tool: NativeToolRecord, val kind: NativeToolKind)

internal fun toolCatalogNormalized(value: String) = value.trim(::toolJsWhitespace).lowercase().replace('ё', 'е')

fun NativeToolCore.searchTools(query: String, kind: NativeToolKind? = null): List<NativeToolCatalogMatch> {
    val needle = toolCatalogNormalized(query)
    val tokens = needle.split(Regex("[\\t\\n\\u000b\\u000c\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+" )).filter { it.length >= 2 }
    return catalogTools().mapNotNull { record ->
        val recordKind = when (record.definition) {
            is NativeToolDefinition.Calculator -> NativeToolKind.Calculator
            is NativeToolDefinition.Assessment -> NativeToolKind.Assessment
        }
        if (kind != null && recordKind != kind) return@mapNotNull null
        val matched = when (val definition = record.definition) {
            is NativeToolDefinition.Calculator -> {
                val value = definition.value
                val haystack = (listOf(record.title, value.summary, value.audience, value.category) + value.tags + record.aliases)
                    .joinToString(" ").lowercase().replace('ё', 'е')
                needle.isEmpty() || haystack.contains(needle)
            }
            is NativeToolDefinition.Assessment -> {
                val haystack = toolCatalogNormalized((listOf(record.title, record.shortTitle, record.description) + record.aliases).joinToString(" "))
                needle.isEmpty() || haystack.contains(needle) || tokens.all(haystack::contains)
            }
        }
        if (matched) NativeToolCatalogMatch(record, recordKind) else null
    }
}
