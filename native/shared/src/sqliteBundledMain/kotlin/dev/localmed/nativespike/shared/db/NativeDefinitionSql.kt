package dev.localmed.nativespike.shared.db

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteStatement
import dev.localmed.nativespike.shared.core.DefinitionDescriptionCandidate
import dev.localmed.nativespike.shared.core.definitionNameTokens
import dev.localmed.nativespike.shared.core.definitionNameTranspositions
import dev.localmed.nativespike.shared.core.definitionQuestionSubject
import dev.localmed.nativespike.shared.core.isDefinitionNavigationOnly
import dev.localmed.nativespike.shared.core.planDefinitionDescription
import dev.localmed.nativespike.shared.core.rankDefinitionDescriptions
import dev.localmed.nativespike.shared.core.normalizeNativeIdentityName
import dev.localmed.nativespike.shared.core.NATIVE_DEFINITION_QUERY_MAX_LENGTH
import dev.localmed.nativespike.shared.core.NATIVE_DEFINITION_RESULTS_MAX
import dev.localmed.nativespike.shared.core.NativeDefinitionBlock
import dev.localmed.nativespike.shared.core.NativeDefinitionBlockPage
import dev.localmed.nativespike.shared.core.NativeDefinitionCard
import dev.localmed.nativespike.shared.core.NativeDefinitionSource
import dev.localmed.nativespike.shared.core.NativeDefinitionStatus
import dev.localmed.nativespike.shared.core.NativeDefinitionTextPage
import dev.localmed.nativespike.shared.core.referenceIdentity
import dev.localmed.nativespike.shared.core.referenceManifest
import dev.localmed.nativespike.shared.core.referenceProvenance
import dev.localmed.nativespike.shared.core.referenceSource

/** Read capability for the existing immutable connection. It never owns or opens handles. */
internal class NativeDefinitionSql(private val db: SQLiteConnection) {
    private var loaded=false
    private var cached: NativeDefinitionStatus?=null
    private val scope="""json_extract(e.metadata_json, '$.definitionReference') = 1
        AND json_extract(e.metadata_json, '$.editionId') = ?
        AND EXISTS (SELECT 1 FROM content_packs p WHERE p.id = ? AND p.enabled = 1)""".trimIndent()

    fun status(): NativeDefinitionStatus? {
        if(loaded) return cached
        val result=db.prepare("""SELECT p.id,p.schema_version,substr(m.value,1,65537)
            FROM app_metadata m JOIN content_packs p
              ON p.id=json_extract(m.value,'$.editionId') AND p.enabled=1
            WHERE m.key='definition_reference' LIMIT 2""").use { row ->
            if(!row.step()) return@use null
            check(row.getLong(1)==7L) { "Unsupported reference schema" }
            val manifest=referenceManifest(row.getText(2))
            check(row.getText(0)==manifest.editionId && !row.step()) { "Ambiguous reference edition" }
            db.prepare("""SELECT count(*) FROM knowledge_entities
                WHERE json_extract(metadata_json,'$.definitionReference')=1
                  AND json_extract(metadata_json,'$.editionId')=?""").use { count ->
                count.bindText(1,manifest.editionId)
                check(count.step() && count.getLong(0)==manifest.entries.toLong()) { "Reference entry count mismatch" }
            }
            manifest
        }
        cached=result;loaded=true
        return result
    }
    private fun belongs(editionId: String): Boolean {
        referenceIdentity(editionId)
        return status()?.editionId==editionId
    }
    private fun SQLiteStatement.scopeAt(index: Int,editionId: String) {
        bindText(index,editionId);bindText(index+1,editionId)
    }
    private fun SQLiteStatement.text(index: Int,maximum: Int=2048): String = getText(index).also {
        check(!isNull(index)) { "Missing reference row text" }
        check(it.length<=maximum && !it.contains('\u0000')) { "Invalid reference row text" }
    }
    private fun SQLiteStatement.integer(index: Int): Int = getLong(index).also {
        check(!isNull(index)) { "Missing reference row integer" }
        check(it in 0..Int.MAX_VALUE.toLong()) { "Invalid reference row integer" }
    }.toInt()

    private val header="""e.id,e.canonical_name,e.entity_type,
        json_extract(e.metadata_json,'$.coverage'),json_extract(e.metadata_json,'$.textKind'),
        json_extract(e.metadata_json,'$.blockCount')""".trimIndent()
    private fun SQLiteStatement.hit(match: String): NativeDefinitionCard {
        val textKind=text(4,40)
        check(textKind in setOf("editorial-paraphrase","source-gloss","source-excerpt")) { "Unsupported reference text kind" }
        return NativeDefinitionCard(referenceIdentity(text(0,256)),text(1),text(2,40),text(3,80),textKind,integer(5),match=match)
    }
    private fun exactNames(edition: String,names: List<String>,limit: Int): List<NativeDefinitionCard> {
        require(names.size in 1..47)
        val predicate=if(names.size==1) "=?" else "IN (${names.joinToString(",") { "?" }})"
        return db.prepare("""SELECT $header,MIN(CASE WHEN n.name_type='primary' THEN 0 ELSE 1 END) AS tier
            FROM knowledge_names n JOIN knowledge_entities e ON e.id=n.entity_id
            WHERE n.normalized_name $predicate AND $scope
            GROUP BY e.id ORDER BY tier,CASE WHEN json_extract(e.metadata_json,'$.coverage')='needs-definition' THEN 1 ELSE 0 END,e.id LIMIT ?""").use { row ->
            names.forEachIndexed { index,name -> row.bindText(index+1,name) }
            row.scopeAt(names.size+1,edition);row.bindLong(names.size+3,limit.toLong())
            buildList { while(row.step()) add(row.hit("name")) }
        }
    }
    fun search(edition: String,query: String,requested: Int): List<NativeDefinitionCard> {
        if(requested<1 || query.length>NATIVE_DEFINITION_QUERY_MAX_LENGTH || query.contains('\u0000')) return emptyList()
        val limit=minOf(requested,NATIVE_DEFINITION_RESULTS_MAX)
        val normalized=normalizeNativeIdentityName(query)
        if(normalized.isEmpty() || normalized.length>NATIVE_DEFINITION_QUERY_MAX_LENGTH || !belongs(edition)) return emptyList()
        exactNames(edition,listOf(normalized),limit).takeIf { it.isNotEmpty() }?.let { return it }
        val subject=definitionQuestionSubject(query)
        if(subject!=null) {
            val framed=normalizeNativeIdentityName(subject)
            if(framed!=normalized) exactNames(edition,listOf(framed),limit).takeIf { it.isNotEmpty() }?.let { return it }
        }
        val variants=definitionNameTranspositions(normalizeNativeIdentityName(subject ?: query))
        if(variants.isNotEmpty()) exactNames(edition,variants,limit).takeIf { it.isNotEmpty() }?.let { return it }
        if(isDefinitionNavigationOnly(query)) return emptyList()
        val description=planDefinitionDescription(query)
        val tokens=definitionNameTokens(normalized)
        if(tokens.isEmpty() || tokens.size>24) return emptyList()
        val fts=tokens.joinToString(" AND ") { "\"$it\""+if(it.length>=4) "*" else "" }
        val names=db.prepare("""SELECT $header FROM knowledge_fts f JOIN knowledge_entities e ON e.id=f.entity_id
            WHERE knowledge_fts MATCH ? AND $scope ORDER BY rank,e.id LIMIT ?""").use { row ->
            row.bindText(1,fts);row.scopeAt(2,edition);row.bindLong(4,limit.toLong())
            buildList { while(row.step()) add(row.hit("name")) }
        }
        if(names.size>=limit && description?.descriptive!=true) return names
        if(description!=null) {
            data class Evidence(val card: NativeDefinitionCard,val chunkId: String,val text: String)
            val evidence=linkedMapOf<Pair<String,String>,Evidence>()
            for(expression in listOf(description.conjunction,description.disjunction)) {
                val candidates=db.prepare("""WITH matches AS MATERIALIZED (
                    SELECT rowid,rank AS score FROM definition_reference_fts WHERE definition_reference_fts MATCH ? ORDER BY rank LIMIT 96
                    ) SELECT $header,c.id,substr(c.original_text,1,4096),MIN(m.score) AS score
                    FROM matches m JOIN chunks c ON c.rowid=m.rowid
                    JOIN definition_reference_links l ON l.chunk_id=c.id JOIN knowledge_entities e ON e.id=l.entity_id
                    WHERE l.review_status<>'rejected' AND l.link_type IN ('reference:definition','reference:item')
                    AND json_extract(e.metadata_json,'$.coverage') IN ('definition','explicit-definition') AND $scope
                    GROUP BY e.id,c.id ORDER BY score,e.id,c.id LIMIT 96""").use { row ->
                    row.bindText(1,expression);row.scopeAt(2,edition)
                    buildList { while(row.step()) add(Evidence(row.hit("text"),row.text(6,256),row.text(7,8192))) }
                }
                check(candidates.size<=96) { "Reverse definition SQL budget exceeded" }
                candidates.forEach { evidence[it.card.id to it.chunkId]=it }
            }
            val headers=linkedMapOf<String,NativeDefinitionCard>()
            val candidates=evidence.values.mapIndexed { rank,row -> headers[row.card.id]=row.card;DefinitionDescriptionCandidate(row.card.id,row.text,rank) }
            val descriptions=rankDefinitionDescriptions(description,candidates).map { headers[it.id] ?: error("Unresolved reverse definition identity") }
            val nameResults=if(description.terms.any { it.absent }) emptyList() else names
            val ordered=if(description.descriptive) descriptions+nameResults else nameResults+descriptions
            // Rejected descriptive evidence never re-enters an unqualified body fallback.
            return ordered.distinctBy { it.id }.take(limit)
        }
        val body=db.prepare("""WITH matches AS MATERIALIZED (
            SELECT rowid,rank AS score FROM definition_reference_fts WHERE definition_reference_fts MATCH ? ORDER BY rank LIMIT 80
            ) SELECT $header,MIN(m.score) AS score FROM matches m JOIN chunks c ON c.rowid=m.rowid
            JOIN definition_reference_links l ON l.chunk_id=c.id JOIN knowledge_entities e ON e.id=l.entity_id
            WHERE l.review_status<>'rejected' AND l.link_type IN ('reference:definition','reference:item') AND $scope
            GROUP BY e.id ORDER BY score,e.id LIMIT ?""").use { row ->
            row.bindText(1,fts);row.scopeAt(2,edition);row.bindLong(4,limit.toLong())
            buildList { while(row.step()) add(row.hit("text")) }
        }
        return (names+body).distinctBy { it.id }.take(limit)
    }

    fun card(editionId: String,id: String): NativeDefinitionCard? {
        referenceIdentity(id)
        if(!belongs(editionId)) return null
        return db.prepare("""SELECT e.id,e.canonical_name,e.entity_type,
            json_extract(e.metadata_json,'$.coverage'),json_extract(e.metadata_json,'$.textKind'),
            json_extract(e.metadata_json,'$.blockCount')
            FROM knowledge_entities e WHERE e.id=? AND $scope LIMIT 1""").use { row ->
            row.bindText(1,id);row.scopeAt(2,editionId)
            if(!row.step()) return@use null
            val textKind=row.text(4,40)
            check(textKind in setOf("editorial-paraphrase","source-gloss","source-excerpt")) { "Unsupported reference text kind" }
            NativeDefinitionCard(referenceIdentity(row.text(0,256)),row.text(1),row.text(2,40),row.text(3,80),textKind,row.integer(5))
        }
    }

    fun blocks(editionId: String,id: String,after: String): NativeDefinitionBlockPage {
        referenceIdentity(id)
        require(after.isEmpty() || (after.length<=300 && after.startsWith(id+".reference.") && Regex("\\.reference\\.\\d{6}$").containsMatchIn(after))) { "Invalid reference block cursor" }
        if(!belongs(editionId)) return NativeDefinitionBlockPage(emptyList(),null)
        val rows=db.prepare("""SELECT l.id,l.chunk_id,l.document_id,
            json_extract(l.metadata_json,'$.role'),length(c.original_text)
            FROM definition_reference_links l JOIN knowledge_entities e ON e.id=l.entity_id
            JOIN chunks c ON c.id=l.chunk_id
            WHERE e.id=? AND l.id>? AND l.review_status<>'rejected' AND $scope
            ORDER BY l.id LIMIT 9""").use { row ->
            row.bindText(1,id);row.bindText(2,after);row.scopeAt(3,editionId)
            buildList {
                while(row.step()) {
                    val role=row.text(3,40)
                    check(role in setOf("definition","item","context","annotation")) { "Unsupported reference block role" }
                    add(NativeDefinitionBlock(row.text(0,300),referenceIdentity(row.text(1,256)),referenceIdentity(row.text(2,256)),role,row.integer(4)))
                }
            }
        }
        return NativeDefinitionBlockPage(rows.take(8),if(rows.size>8) rows[7].linkId else null)
    }

    fun text(editionId: String,id: String,chunkId: String,offset: Int): NativeDefinitionTextPage? {
        referenceIdentity(id);referenceIdentity(chunkId)
        require(offset in 0..262144) { "Invalid reference text offset" }
        if(!belongs(editionId)) return null
        return db.prepare("""SELECT substr(c.original_text,?,4096),length(c.original_text),
            substr(c.metadata_json,1,65537),l.document_id
            FROM chunks c JOIN definition_reference_links l ON l.chunk_id=c.id
            JOIN knowledge_entities e ON e.id=l.entity_id
            WHERE e.id=? AND c.id=? AND l.review_status<>'rejected' AND $scope LIMIT 1""").use { row ->
            row.bindLong(1,offset.toLong()+1);row.bindText(2,id);row.bindText(3,chunkId);row.scopeAt(4,editionId)
            if(!row.step()) return@use null
            val total=row.integer(1)
            NativeDefinitionTextPage(row.text(0,8192),if(offset+4096<total) offset+4096 else null,total,
                referenceIdentity(row.text(3,256)),referenceProvenance(row.text(2,65536)),if(offset==0) null else maxOf(0,offset-4096))
        }
    }

    fun source(editionId: String,id: String): NativeDefinitionSource? {
        referenceIdentity(id)
        if(!belongs(editionId)) return null
        return db.prepare("""SELECT d.title,substr(d.metadata_json,1,65537)
            FROM documents d JOIN content_packs p ON p.id=d.content_pack_id
            WHERE d.id=? AND p.id=? AND p.enabled=1
              AND json_extract(d.metadata_json,'$.definitionReference')=1 LIMIT 1""").use { row ->
            row.bindText(1,id);row.bindText(2,editionId)
            if(!row.step()) null else referenceSource(id,row.text(0),row.text(1,65536))
        }
    }
}
