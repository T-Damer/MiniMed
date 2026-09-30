package dev.localmed.nativespike.shared.core

import dev.localmed.nativespike.shared.content.contentJson
import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import java.io.File
import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private fun digestText(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
private fun digestFile(file: File): String {
    val hash=MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input -> val bytes=ByteArray(65536);while(true) { val count=input.read(bytes);if(count<0) break;hash.update(bytes,0,count) } }
    return hash.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
}
private fun resource(name: String)=contentJson.parseToJsonElement(File(System.getProperty("TEST_RESOURCE_DIR"),name).readText()).jsonObject

class NativeIdentityReferenceGoldenTest {
    @Test
    fun all259ExactIdentitiesPreservePunctuationStopWordsAndAmbiguity() {
        val fixture=resource("core-identities-golden.json")
        val file=File(System.getProperty("CORE_DB_PATH"))
        assertEquals(fixture["coreSha256"]!!.jsonPrimitive.content.removePrefix("sha256:"),digestFile(file))
        val db=NativeSearchDatabase(file.path)
        try {
            db.open()
            val cases=fixture["cases"]!!.jsonArray
            assertEquals(259,cases.size)
            cases.forEachIndexed { index,value ->
                val row=value.jsonObject;val query=row["query"]!!.jsonPrimitive.content
                assertEquals(row["normalized"]!!.jsonPrimitive.content,normalizeNativeIdentityName(query),"Identity normalization case $index")
                assertEquals(contentJson.decodeFromJsonElement<List<NativeCoreIdentityHit>>(row["hits"]!!),db.lookupIdentities(query),"Exact identity case $index")
            }
        } finally { db.close() }
    }

    @Test
    fun currentReferenceCardsBlocksAndAll88OriginalUnicodePagesMatchReleasedHashes() {
        val fixture=resource("definition-reference-golden.json")
        val file=File(System.getProperty("NATIVE_REFERENCE_DB_PATH"))
        assertEquals(fixture["packSha256"]!!.jsonPrimitive.content.removePrefix("sha256:"),digestFile(file))
        val edition=fixture["editionId"]!!.jsonPrimitive.content
        val db=NativeSearchDatabase(file.path)
        var blocks=0;var pages=0
        try {
            db.open()
            val status=assertNotNull(db.definitionStatus())
            assertEquals(edition,status.editionId);assertEquals(31488,status.entries)
            assertEquals("experimental-preview",status.publicationState);assertEquals("requires-review",status.reviewStatus)
            assertEquals("source-local-proposed",status.identityStatus);assertTrue(!status.annotationsSupported)
            val cards=fixture["cards"]!!.jsonArray
            assertEquals(22,cards.size)
            cards.forEach { value ->
                val row=value.jsonObject
                val expected=contentJson.decodeFromJsonElement<NativeDefinitionCard>(row["card"]!!)
                assertEquals(expected,db.definitionCard(edition,expected.id))
                val first=contentJson.decodeFromJsonElement<NativeDefinitionBlockPage>(row["first"]!!)
                assertEquals(first,db.definitionBlocks(edition,expected.id,""))
                if(row["second"]!=JsonNull) assertEquals(contentJson.decodeFromJsonElement<NativeDefinitionBlockPage>(row["second"]!!),db.definitionBlocks(edition,expected.id,first.next!!))
                row["blocks"]!!.jsonArray.forEach { blockValue ->
                    blocks++
                    val blockRow=blockValue.jsonObject
                    val block=contentJson.decodeFromJsonElement<NativeDefinitionBlock>(blockRow["block"]!!)
                    val whole=StringBuilder()
                    blockRow["pages"]!!.jsonArray.forEach { pageValue ->
                        pages++
                        val p=pageValue.jsonObject;val offset=p["offset"]!!.jsonPrimitive.int
                        val actual=assertNotNull(db.definitionText(edition,expected.id,block.chunkId,offset))
                        assertEquals(p["textSha256"]!!.jsonPrimitive.content,digestText(actual.text))
                        assertEquals(if(p["nextOffset"]==JsonNull) null else p["nextOffset"]!!.jsonPrimitive.int,actual.nextOffset)
                        assertEquals(if(offset==0) null else maxOf(0,offset-4096),actual.previousOffset)
                        assertEquals(p["totalCharacters"]!!.jsonPrimitive.int,actual.totalCharacters)
                        assertEquals(p["sourceId"]!!.jsonPrimitive.content,actual.sourceId)
                        assertEquals(p["provenanceSha256"]!!.jsonPrimitive.content,digestText(actual.provenance.rawMetadata))
                        whole.append(actual.text)
                    }
                    assertEquals(blockRow["wholeTextSha256"]!!.jsonPrimitive.content,digestText(whole.toString()))
                    val source=assertNotNull(db.definitionSource(edition,block.sourceId))
                    assertEquals(blockRow["sourceMetadataSha256"]!!.jsonPrimitive.content,digestText(source.rawMetadata))
                    assertTrue(!source.releaseEligible);assertEquals("requires-review",source.reviewStatus)
                }
            }
            assertEquals(73,blocks);assertEquals(88,pages)
        } finally { db.close() }
    }

    @Test
    fun referenceReaderRejectsForeignCursorsUnsupportedLayoutsAndCrossEditionReads() {
        val fixture=resource("definition-reference-golden.json");val edition=fixture["editionId"]!!.jsonPrimitive.content
        val first=fixture["cards"]!!.jsonArray.first().jsonObject
        val id=first["card"]!!.jsonObject["id"]!!.jsonPrimitive.content
        val chunk=first["blocks"]!!.jsonArray.first().jsonObject["block"]!!.jsonObject["chunkId"]!!.jsonPrimitive.content
        val db=NativeSearchDatabase(File(System.getProperty("NATIVE_REFERENCE_DB_PATH")).path)
        try {
            db.open()
            assertNull(db.definitionCard("minimed.definition.reference.2026.9.27",id))
            assertNull(db.definitionText("minimed.definition.reference.2026.9.27",id,chunk,0))
            assertNull(db.definitionText(edition,"reference.entity.missing",chunk,0))
            val pastEnd=assertNotNull(db.definitionText(edition,id,chunk,262144))
            assertEquals("",pastEnd.text);assertNull(pastEnd.nextOffset)
            assertFailsWith<IllegalArgumentException> { db.definitionBlocks(edition,id,"foreign.reference.000001") }
            assertFailsWith<IllegalArgumentException> { db.definitionText(edition,id,chunk,-1) }
            assertFailsWith<IllegalArgumentException> { db.definitionText(edition,id,chunk,262145) }
            assertFailsWith<IllegalArgumentException> { referenceMetadata("{\"\$p\":1}") }
            assertFailsWith<IllegalArgumentException> { referenceManifest("{\"contract\":1,\"publicationState\":\"experimental-preview\",\"reviewStatus\":\"requires-review\",\"identityStatus\":\"source-local-proposed\",\"linkLayout\":\"numeric-v1\",\"metadataLayout\":\"fragments-v1\",\"entries\":1,\"editionId\":\"edition\"}") }
        } finally { db.close() }
    }
}
