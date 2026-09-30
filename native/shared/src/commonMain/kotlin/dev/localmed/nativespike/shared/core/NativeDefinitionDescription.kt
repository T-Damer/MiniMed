package dev.localmed.nativespike.shared.core

import dev.localmed.nativespike.shared.lexical.localeCompareApprox
import dev.localmed.nativespike.shared.text.lightStemRussian
import dev.localmed.nativespike.shared.text.normalizeSurfaceText
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.ln

private val STOP=setOf("а","бы","в","во","для","до","же","и","из","или","к","как","ко","ли","на","но","о","об","от","по","под","при","с","со","у","что","это","этот","эта","эти","такой","такая","такое","когда","который","которая","которые","которое","его","ее","их","он","она","они","оно","себя","собой","есть","является","представляет","помощью","одного","одной","один")
private val FRAMING=Regex("^(?:(?:как\\s+(?:это\\s+)?называется|что\\s+(?:это\\s+)?за\\s+термин|не\\s+(?:помню|знаю)\\s+(?:название|термин)|найди\\s+(?:термин|определение)|найти\\s+(?:термин|определение))\\s*[,.:—-]?\\s*(?:когда\\s+)*)")
private val ABSENCE=Regex("^(?:не|нет|без|отсутств\\p{L}*|отрица\\p{L}*)$")
private const val DESCRIPTION_CANDIDATES=192
private const val DESCRIPTION_CHARACTERS=4096

internal data class DefinitionFeature(val surface: String,val stem: String,val absent: Boolean,val position: Int)
internal data class DefinitionDescriptionPlan(val subject: String,val descriptive: Boolean,val terms: List<DefinitionFeature>,val conjunction: String,val disjunction: String)
internal data class DefinitionDescriptionCandidate(val id: String,val text: String,val retrievalRank: Int)
internal data class RankedDefinitionDescription(val id: String,val score: Double,val matched: Int,val total: Int)

private fun russian(c: Char)=c in 'а'..'я'
private fun wordLetter(c: Char)=russian(c) || c in 'a'..'z'
private fun stem(value: String): String {
    val normalized=lightStemRussian(value)
    if(normalized!=value) return normalized
    if(value.length>=8 && value.all(::russian) && (value.endsWith("ых") || value.endsWith("их"))) return value.dropLast(2)
    if(value.length==4 && value.all(::russian) && value.last() in "аяуюыие") return value.dropLast(1)
    return value
}
private fun surface(value: String)=normalizeSurfaceText(value.replace(Regex("[;!?]"),"."))
private fun features(value: String): List<DefinitionFeature> {
    val result=mutableListOf<DefinitionFeature>();var position=0
    val normalized=surface(value).replace(Regex("(^|\\s)не\\s+только(?=\\s|$)"),"$1")
    for(clause in normalized.split(Regex("[.,:;!?]|\\s(?:но|однако|зато)\\s"))) {
        val ordered=Regex("[\\p{L}\\p{N}]+").findAll(clause).map { it.value }.toList()
        val absent=ordered.any { ABSENCE.matches(it) }
        for(word in ordered) {
            val current=position++
            if(word.length<2 || word in STOP || ABSENCE.matches(word)) continue
            result.add(DefinitionFeature(word,stem(word),absent,current))
        }
    }
    return result
}
internal fun isDefinitionNavigationOnly(value: String): Boolean {
    val normalized=surface(value)
    return normalized.isNotEmpty() && normalized.replace(FRAMING,"").replace(Regex("[.\\s]+$"),"").isEmpty()
}
internal fun planDefinitionDescription(value: String): DefinitionDescriptionPlan? {
    if(value.isEmpty() || value.length>NATIVE_DEFINITION_QUERY_MAX_LENGTH || value.contains('\u0000')) return null
    val normalized=surface(value);val subject=normalized.replace(FRAMING,"").trim()
    if(subject.isEmpty()) return null
    val unique=linkedMapOf<String,DefinitionFeature>()
    for(feature in features(subject)) {
        val previous=unique[feature.stem]
        if(previous!=null && previous.absent!=feature.absent) return null
        if(previous==null) unique[feature.stem]=feature
    }
    val terms=unique.values.toList()
    if(terms.size !in 2..16) return null
    val expressions=terms.map { "\"${it.stem}\""+if(it.stem.length>=3 && it.stem.all(::wordLetter)) "*" else "" }
    return DefinitionDescriptionPlan(subject,subject!=normalized || terms.size>=3 || terms.any { it.absent },terms,expressions.joinToString(" AND "),expressions.joinToString(" OR "))
}
private fun transposed(left: String,right: String): Boolean {
    if(left.length!=right.length || left.length<6 || !left.all(::wordLetter)) return false
    var at=0;while(at<left.length && left[at]==right[at]) at++
    return at+1<left.length && left[at]==right[at+1] && left[at+1]==right[at] && left.substring(at+2)==right.substring(at+2)
}
private fun strength(query: DefinitionFeature,candidate: DefinitionFeature): Double {
    if(query.surface==candidate.surface) return 1.0
    if(query.stem==candidate.stem) return .96
    if(query.stem.length>=4 && candidate.stem.length>=4 && query.stem.all(::wordLetter) && candidate.stem.all(::wordLetter) && abs(query.stem.length-candidate.stem.length)<=2 && (query.stem.startsWith(candidate.stem) || candidate.stem.startsWith(query.stem))) return .8
    if(transposed(query.stem,candidate.stem)) return .85
    return 0.0
}
private fun codepoints(value: String): Int {
    var count=value.length
    for(index in 0 until value.lastIndex) if(value[index] in '\ud800'..'\udbff' && value[index+1] in '\udc00'..'\udfff') count--
    return count
}
private data class FeatureMatch(val best: Double,val at: Int,val conflict: Boolean)
private data class AnalyzedDescription(val candidate: DefinitionDescriptionCandidate,val words: List<DefinitionFeature>,val matches: List<FeatureMatch>)

/** Source passages remain separate evidence; neither duplicates nor disjoint text create coverage. */
internal fun rankDefinitionDescriptions(plan: DefinitionDescriptionPlan,candidates: List<DefinitionDescriptionCandidate>): List<RankedDefinitionDescription> {
    require(candidates.size<=DESCRIPTION_CANDIDATES) { "Description candidate budget exceeded" }
    val analyzed=candidates.map { candidate ->
        require(candidate.id.isNotEmpty() && candidate.text.length<=DESCRIPTION_CHARACTERS*2 && codepoints(candidate.text)<=DESCRIPTION_CHARACTERS) { "Invalid bounded definition candidate" }
        val words=features(candidate.text)
        val matches=plan.terms.map { term ->
            var compatible=0.0;var opposite=0.0;var at=-1
            for(word in words) {
                val quality=strength(term,word)
                if(term.absent!=word.absent) opposite=maxOf(opposite,quality)
                else if(quality>compatible) { compatible=quality;at=word.position }
            }
            FeatureMatch(compatible,at,opposite>0 && compatible==0.0)
        }
        AnalyzedDescription(candidate,words,matches)
    }
    val identities=analyzed.map { it.candidate.id }.distinct().size
    val weights=plan.terms.indices.map { index ->
        val owners=analyzed.filter { it.matches[index].best>0 }.map { it.candidate.id }.distinct().size
        1+ln((identities+1).toDouble()/(owners+1))
    }
    val totalWeight=weights.sum();val best=linkedMapOf<String,RankedDefinitionDescription>()
    for(row in analyzed) {
        val matched=row.matches.count { it.best>0 }
        if(matched<maxOf(2,ceil(plan.terms.size*.6).toInt()) || row.matches.any { it.conflict }) continue
        val coverage=row.matches.mapIndexed { index,match -> match.best*weights[index] }.sum()/totalWeight
        if(coverage<.6) continue
        val positions=row.matches.filter { it.at>=0 }.map { it.at }
        val span=positions.max()-positions.min()+1
        val proximity=matched.toDouble()/maxOf(matched,span)
        val score=coverage*8+proximity+matched.toDouble()/maxOf(matched,row.words.size)
        val outcome=RankedDefinitionDescription(row.candidate.id,score,matched,plan.terms.size)
        if(best[outcome.id]?.score?.let { it>=score }!=true) best[outcome.id]=outcome
    }
    return best.values.sortedWith { a,b -> b.score.compareTo(a.score).takeIf { it!=0 } ?: localeCompareApprox(a.id,b.id) }
}
