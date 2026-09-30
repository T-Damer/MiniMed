package dev.localmed.nativespike.shared.content

import dev.localmed.nativespike.shared.core.NativeDefinitionTarget
import dev.localmed.nativespike.shared.core.validateDefinitionTarget
import dev.localmed.nativespike.shared.core.referenceIdentity
import dev.localmed.nativespike.shared.core.NativeDocumentTarget
import dev.localmed.nativespike.shared.core.NativeModuleOffer
import dev.localmed.nativespike.shared.core.NativeCatalogDocument
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

internal val contentJson = Json { ignoreUnknownKeys = false }
internal val checksumPattern = Regex("sha256:[a-f0-9]{64}")
internal fun JsonObject.string(name: String): String = optionalString(name)?.takeIf { it.isNotBlank() } ?: error("Missing $name")
internal fun JsonObject.optionalString(name: String): String? = (get(name) as? JsonPrimitive)?.takeIf { it.isString }?.content
internal fun JsonObject.integer(name: String): Int = (get(name) as? JsonPrimitive)?.intOrNull ?: error("Invalid $name")
internal fun normalizedChecksum(value: String): String = (if (value.startsWith("sha256:")) value else "sha256:$value").also { require(checksumPattern.matches(it)) { "Invalid source checksum" } }
internal fun validateTarget(target: NativeDocumentTarget) {
    require(target.documentId.isNotBlank() && target.documentVersionId.isNotBlank() && checksumPattern.matches(target.sourceChecksum)) { "Invalid source target" }
    require((target.moduleId == null) == (target.moduleVersion == null)) { "Incomplete module target" }
    require(target.moduleId == null || (target.moduleId.isNotBlank() && target.moduleVersion!!.isNotBlank())) { "Invalid module target" }
    require(target.anchor == null || target.anchor.isNotBlank()) { "Invalid source anchor" }
}

@Serializable
data class NativeArtifact(
    val id: String,
    val url: String,
    val sha256: String,
    val sizeBytes: Long,
    val compression: String = "none",
    val decodedSha256: String = sha256,
    val decodedSizeBytes: Long = sizeBytes,
)

internal data class NativeMembership(val documentId: String, val versionId: String, val sourceChecksum: String, val status: String, val indexArtifactId: String, val title: String? = null) {
    fun target(module: NativeModule, anchor: String?) = NativeDocumentTarget(documentId, versionId, sourceChecksum, anchor, module.id, module.version)
}
internal data class NativeModule(val id: String, val version: String, val title: String, val schemaVersion: Int, val sourceSetDigest: String?, val releaseState: String, val raw: JsonObject, val members: List<NativeMembership>) {
    fun offer(): NativeModuleOffer {
        var reason: String? = null
        val artifact = try { index() } catch (cause: IllegalArgumentException) {
            reason = cause.message ?: "Unsupported source module"; null
        } catch (cause: IllegalStateException) {
            reason = cause.message ?: "Unavailable source module"; null
        }
        return NativeModuleOffer(id, version, title, raw.string("kind"), releaseState,
            members.map { it.documentId }.distinct().size, members.size, artifact?.sizeBytes, reason, runCatching { definitionDescriptor()?.second }.getOrNull())
    }
    fun documents(): List<NativeCatalogDocument> = members.map { NativeCatalogDocument(it.target(this, null), it.title, it.status) }
    fun definitionDescriptor(): Pair<String,Int>? {
        val value=raw["definitionReference"] ?: return null
        val descriptor=value.jsonObject
        require(schemaVersion==7 && descriptor.integer("contract")==1) { "Unsupported reference capability" }
        val edition=referenceIdentity(descriptor.string("editionId"))
        val entries=descriptor.integer("entries");require(entries in 1..100000) { "Invalid reference inventory" }
        return edition to entries
    }
    fun index(): NativeArtifact {
        require(releaseState in setOf("published", "preview")) { "Module is not released" }
        require(schemaVersion == 2 || (schemaVersion==7 && definitionDescriptor()!=null)) { "This source schema is not supported" }
        val compatibility = raw["compatibility"]!!.jsonObject
        fun version(value: String): List<Int> = value.substringBefore('-').split('.').map { it.toInt() }
        fun compare(left: String, right: String): Int {
            val a = version(left); val b = version(right)
            for (i in 0 until maxOf(a.size,b.size)) { val d = a.getOrElse(i) { 0 }.compareTo(b.getOrElse(i) { 0 }); if (d != 0) return d }
            return 0
        }
        require(compare("0.6.45", compatibility.string("minAppVersion")) >= 0 && compatibility.optionalString("maxAppVersion")?.let { compare("0.6.45", it) <= 0 } != false) { "Incompatible application version" }
        require(compatibility.string("coreCatalogVersion") == "1") { "Incompatible core catalog" }
        val artifacts = raw["artifacts"]!!.jsonArray.map { it.jsonObject }
        require(artifacts.none { it["required"]?.jsonPrimitive?.booleanOrNull == true && it.string("kind") != "index" }) { "Required source assets are unsupported" }
        val index = artifacts.filter { it.string("kind") == "index" }.singleOrNull() ?: error("Module requires exactly one index")
        require(index["required"]?.jsonPrimitive?.booleanOrNull == true) { "Index is not required" }
        require(sourceSetDigest != null && checksumPattern.matches(sourceSetDigest) && index.string("sourceSetDigest") == sourceSetDigest) { "Index source set mismatch" }
        val url = index.string("url"); require(url.startsWith("https://")) { "Index requires HTTPS" }
        val sha = index.string("sha256"); require(checksumPattern.matches(sha)) { "Invalid index checksum" }
        val size = index["sizeBytes"]?.jsonPrimitive?.longOrNull ?: error("Missing index size"); require(size > 0)
        val codec = index.string("compression"); require(codec in setOf("none", "gzip")) { "Unsupported index compression" }
        val decodedSha = if (codec == "none") sha else index.string("decodedSha256")
        val decodedSize = if (codec == "none") size else index["decodedSizeBytes"]?.jsonPrimitive?.longOrNull ?: error("Missing decoded size")
        require(checksumPattern.matches(decodedSha) && decodedSize > 0)
        val artifact = NativeArtifact(index.string("id"),url,sha,size,codec,decodedSha,decodedSize)
        require(if(schemaVersion==7) members.isEmpty() && definitionDescriptor()!=null else members.isNotEmpty() && members.all { it.indexArtifactId == artifact.id }) { "Missing exact index membership" }
        return artifact
    }
}

internal class NativeCatalog private constructor(val modules: List<NativeModule>) {
    fun exactDefinition(target: NativeDefinitionTarget): NativeModule? {
        validateDefinitionTarget(target)
        return modules.singleOrNull { it.id==target.moduleId && it.version==target.moduleVersion && it.definitionDescriptor()?.first==target.editionId }
    }
    fun exact(target: NativeDocumentTarget): NativeModule? {
        validateTarget(target)
        return modules.singleOrNull { m -> m.id == target.moduleId && m.version == target.moduleVersion && m.members.any { it.documentId == target.documentId && it.versionId == target.documentVersionId && it.sourceChecksum == target.sourceChecksum } }
    }
    fun resolve(documentId: String, moduleIds: List<String>, anchor: String?): NativeDocumentTarget? {
        val candidates = modules.filter { m -> m.members.any { it.documentId == documentId } && runCatching { m.index() }.isSuccess }
        val declared = moduleIds.flatMap { id -> candidates.filter { it.id == id } }
        if (declared.isEmpty() && candidates.flatMap { it.members.filter { member -> member.documentId == documentId } }.map { it.versionId to it.sourceChecksum }.distinct().size > 1) return null
        val ordered = declared.ifEmpty { candidates }
        for (module in ordered) {
            val members = module.members.filter { it.documentId == documentId }
            if (members.size == 1) return members.single().target(module,anchor)
        }
        return null
    }
    companion object {
        fun parse(text: String): NativeCatalog {
            val root = contentJson.parseToJsonElement(text).jsonObject
            root.string("catalogVersion")
            val modules = root["modules"]!!.jsonArray.map { value ->
                val m = value.jsonObject
                require(!(m.containsKey("documentTable") && m.containsKey("documents"))) { "Ambiguous catalog membership encoding" }
                val members = if (m.containsKey("documentTable")) {
                    val table = m["documentTable"]!!.jsonObject
                    require(table.keys == setOf("indexArtifactId","rows"))
                    val defaultIndex = table.string("indexArtifactId")
                    table["rows"]!!.jsonArray.map { row ->
                        val r = row.jsonArray; require(r.size in 4..5)
                        val id = r[0].jsonPrimitive.also { require(it.isString) }.content
                        val v = r[1].jsonPrimitive.also { require(it.isString) }.content
                        require(id.isNotBlank() && v.isNotBlank())
                        val override = if (r.size == 5) r[4].jsonObject else JsonObject(emptyMap())
                        require(override.keys.all { it in setOf("status","indexArtifactId","sourceAssetArtifactId") })
                        require(r[3] == JsonNull || (r[3] as? JsonPrimitive)?.isString == true)
                        NativeMembership(id,if (v.startsWith('@')) id+v else v,normalizedChecksum(r[2].jsonPrimitive.also { require(it.isString) }.content),override.optionalString("status") ?: "active",override.optionalString("indexArtifactId") ?: defaultIndex,(r[3] as? JsonPrimitive)?.takeIf { it.isString }?.content)
                    }
                } else (m["documents"] as? JsonArray)?.map { value ->
                    val d = value.jsonObject
                    NativeMembership(d.string("documentId"),d.string("documentVersionId"),normalizedChecksum(d.string("sourceChecksum")),d.string("status"),d.string("indexArtifactId"),d.optionalString("title"))
                } ?: emptyList()
                require(members.all { it.status in setOf("active","historical","superseded") })
                require(members.map { it.documentId to it.versionId }.distinct().size == members.size) { "Duplicate source membership" }
                NativeModule(m.string("id"),m.string("version"),m.string("title"),m["compatibility"]!!.jsonObject.integer("schemaVersion"),m.optionalString("sourceSetDigest"),m.string("releaseState"),m,members)
            }
            require(modules.map { it.id }.distinct().size == modules.size) { "Duplicate catalog module" }
            return NativeCatalog(modules)
        }
    }
}
