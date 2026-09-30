package dev.localmed.nativespike.shared.db

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteStatement
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
