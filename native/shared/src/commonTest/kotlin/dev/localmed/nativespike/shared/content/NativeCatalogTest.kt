package dev.localmed.nativespike.shared.content

import dev.localmed.nativespike.shared.core.NativeDocumentTarget
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

class NativeCatalogTest {
    @Test
    fun bundledCatalogRetainsExactRegulatoryEditionAndGzipTransport(): Unit = runBlocking {
        val catalog=NativeCatalog.parse(bundledNativeCatalog())
        val module=catalog.modules.single { it.id=="minimed.regulatory.pediatrics.ru" }
        assertEquals(3,module.members.size)
        assertEquals("sha256:61b82c9cc8a6899b24e7b6208642a35ef1a448e15c08990df3c79c7b911ca040",module.index().sha256)
        val target=module.members.single { it.documentId=="regulatory.rf.minzdrav.302n-2019" }.target(module,null)
        assertNotNull(catalog.exact(target))
        assertNull(catalog.exact(target.copy(documentVersionId="different-edition")))
        assertNull(catalog.exact(target.copy(sourceChecksum="sha256:"+"0".repeat(64))))
        assertEquals("gzip",catalog.modules.single { it.id=="minimed.mkb.ru" }.index().compression)
    }

    @Test
    fun compactMembershipRejectsDuplicatesAndTwoIndexes(): Unit = runBlocking {
        val parsed=contentJson.parseToJsonElement(bundledNativeCatalog()).jsonObject
        val original=parsed["modules"]!!.let { it as JsonArray }.single { it.jsonObject.optionalString("id")=="minimed.regulatory.pediatrics.ru" }.jsonObject
        val table=original["documentTable"]!!.jsonObject
        val rows=table["rows"] as JsonArray
        val duplicate=JsonObject(original+ ("documentTable" to JsonObject(table+("rows" to JsonArray(rows+rows.first())))))
        fun catalog(module: JsonObject)=JsonObject(mapOf("catalogVersion" to JsonPrimitive("test"),"modules" to JsonArray(listOf(module)))).toString()
        assertFailsWith<IllegalArgumentException> { NativeCatalog.parse(catalog(duplicate)) }
        val missingTitle=JsonArray((rows.first() as JsonArray).mapIndexed { i,value -> if(i==3) JsonNull else value })
        val unnamed=JsonObject(original+("documentTable" to JsonObject(table+("rows" to JsonArray(listOf(missingTitle))))))
        assertNull(NativeCatalog.parse(catalog(unnamed)).modules.single().documents().single().title)
        val indexes=original["artifacts"] as JsonArray
        val two=JsonObject(original+("artifacts" to JsonArray(indexes+indexes.first())))
        assertFailsWith<IllegalStateException> { NativeCatalog.parse(catalog(two)).modules.single().index() }
    }

    @Test
    fun sourceTargetRequiresExactVersionRawChecksumAndPairedModuleIdentity() {
        val target=NativeDocumentTarget("source","source@edition","sha256:"+"a".repeat(64))
        validateTarget(target)
        assertFailsWith<IllegalArgumentException> { validateTarget(target.copy(moduleId="module")) }
        assertFailsWith<IllegalArgumentException> { validateTarget(target.copy(sourceChecksum="unverified")) }
        assertFailsWith<IllegalArgumentException> { validateTarget(target.copy(anchor="")) }
    }
    @Test
    fun offersRetainUnsupportedModulesAndExactInventoryTitles(): Unit = runBlocking {
        val catalog=NativeCatalog.parse(bundledNativeCatalog())
        assertEquals(782,catalog.modules.size)
        val module=catalog.modules.single { it.id=="minimed.regulatory.pediatrics.ru" }
        val offer=module.offer()
        assertEquals(3,offer.documentCount)
        assertEquals(3,offer.documentVersionCount)
        assertEquals(401408L,offer.downloadBytes)
        assertNull(offer.unsupportedReason)
        assertEquals(module.members.map { it.versionId },module.documents().map { it.target.documentVersionId })
        assertEquals(module.members.map { it.sourceChecksum },module.documents().map { it.target.sourceChecksum })
        assertEquals(module.members.map { it.status },module.documents().map { it.status })
        assertEquals(module.members.map { it.title },module.documents().map { it.title })
        kotlin.test.assertTrue(module.documents().all { it.title==null })
        assertEquals("A00 Холера, МКБ-10",catalog.modules.single { it.id=="minimed.mkb.ru" }.documents().single { it.target.documentId=="rls.mkb.node.a00" }.title)
        kotlin.test.assertTrue(catalog.modules.filter { it.schemaVersion !in setOf(2,7) }.all { it.offer().unsupportedReason!=null })
        val reference=catalog.modules.single { it.id=="minimed.definition.reference.ru" }.offer()
        assertEquals(31488,reference.definitionEntryCount)
        assertEquals(0,reference.documentCount)
        assertNull(reference.unsupportedReason)
        kotlin.test.assertTrue(catalog.modules.any { it.offer().unsupportedReason!=null })
    }

}
