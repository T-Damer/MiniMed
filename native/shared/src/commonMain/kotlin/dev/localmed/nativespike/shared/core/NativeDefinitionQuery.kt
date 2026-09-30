package dev.localmed.nativespike.shared.core

private val REFERENCE_SPACE="[\t\n\u000b\u000c\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]"
private val QUESTION=Regex("^(?:что\\s+(?:такое|означает|значит)|(?:дай(?:те)?|покажи(?:те)?)\\s+определение(?:\\s+термина)?|определение(?:\\s+(?:слова|термина))?|найди\\s+(?:термин|определение)|как\\s+(?:это\\s+)?называется|не\\s+помню\\s+(?:название|термин))(?:\\s|[:—-])+".replace("\\s",REFERENCE_SPACE),RegexOption.IGNORE_CASE)

private fun isReferenceWhitespace(c: Char): Boolean = c in '\t'..'\r' || c==' ' || c=='\u00a0' || c=='\u1680' || c in '\u2000'..'\u200a' || c=='\u2028' || c=='\u2029' || c=='\u202f' || c=='\u205f' || c=='\u3000' || c=='\ufeff'
private fun String.referenceTrim()=trim(::isReferenceWhitespace)

/** Language framing only; the caller must prove the complete literal subject in the name index. */
internal fun definitionQuestionSubject(query: String): String? {
    if(query.isEmpty() || query.length>NATIVE_DEFINITION_QUERY_MAX_LENGTH || query.contains('\u0000')) return null
    val original=query.referenceTrim()
    val prefix=QUESTION.find(original) ?: return null
    var subject=original.substring(prefix.value.length).referenceTrim().replace(Regex("[?？]+$"),"").referenceTrim()
    for((open,close) in listOf("«" to "»","“" to "”","\"" to "\"")) {
        if(subject.startsWith(open) && subject.endsWith(close) && subject.length>2) { subject=subject.substring(1,subject.length-1).referenceTrim();break }
    }
    return subject.takeIf { it.isNotEmpty() && it.length<=512 }
}

/** At most47 single adjacent swaps; no short/numeric/mixed-script clinical identity fuzzing. */
internal fun definitionNameTranspositions(name: String): List<String> {
    if(name.length !in 6..48 || !(name.all { it in 'а'..'я' } || name.all { it in 'a'..'z' })) return emptyList()
    val variants=linkedSetOf<String>()
    for(index in 0 until name.lastIndex) {
        if(name[index]==name[index+1]) continue
        variants.add(name.substring(0,index)+name[index+1]+name[index]+name.substring(index+2))
    }
    return variants.toList()
}

internal fun definitionNameTokens(normalized: String): List<String> = Regex("[\\p{L}\\p{N}]+").findAll(normalized).map { it.value }.distinct().toList()
