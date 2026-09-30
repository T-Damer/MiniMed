package dev.localmed.nativespike.shared.core

import dev.localmed.nativespike.shared.content.contentJson
import dev.localmed.nativespike.shared.content.integer
import dev.localmed.nativespike.shared.content.optionalString
import dev.localmed.nativespike.shared.content.string
import dev.localmed.nativespike.shared.text.compatibilityNormalize
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject

internal fun normalizeNativeIdentityName(query: String): String =
    compatibilityNormalize(query).lowercase().replace('ё', 'е').replace(Regex("[\t\n\u000b\u000c\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+"), " ").trim(' ')

internal fun referenceIdentity(value: String): String = value.also {
    require(it.length in 1..256 && Regex("^[a-z0-9]+(?:[.-][a-z0-9]+)*$").matches(it)) { "Invalid reference identity" }
}

internal fun validateDefinitionTarget(target: NativeDefinitionTarget) {
    referenceIdentity(target.moduleId)
    referenceIdentity(target.entityId)
    referenceIdentity(target.editionId)
    require(target.moduleVersion.isNotBlank() && target.moduleVersion.length <= 256 && !target.moduleVersion.contains('\u0000')) { "Invalid module version" }
}

internal fun referenceMetadata(raw: String): JsonObject {
    require(raw.length <= 65536 && !raw.contains('\u0000')) { "Invalid reference metadata size" }
    val objectValue=try { contentJson.parseToJsonElement(raw) as? JsonObject } catch(cause: SerializationException) { throw IllegalArgumentException("Malformed reference metadata") }
    return (objectValue ?: throw IllegalArgumentException("Reference metadata is not an object")).also {
        require(!(it.size == 1 && (it["$"+"p"] as? JsonPrimitive)?.intOrNull == 1)) { "Unresolved reference metadata marker" }
    }
}

internal fun referenceManifest(raw: String): NativeDefinitionStatus {
    val manifest=referenceMetadata(raw)
    require(manifest.integer("contract") == 1 && manifest.string("publicationState") == "experimental-preview" &&
        manifest.string("reviewStatus") == "requires-review" && manifest.string("identityStatus") == "source-local-proposed") { "Unsupported definition reference trust contract" }
    require(manifest.string("linkLayout") == "numeric-v1" && !manifest.containsKey("metadataLayout") && !manifest.containsKey("annotationLayout")) { "Unsupported definition reference layout" }
    val entries=manifest.integer("entries")
    require(entries in 1..100000) { "Invalid reference entry count" }
    return NativeDefinitionStatus(referenceIdentity(manifest.string("editionId")), entries,
        manifest.string("publicationState"), manifest.string("reviewStatus"), manifest.string("identityStatus"))
}

private fun JsonObject.optionalText(key: String): String? {
    if (!containsKey(key) || get(key) == kotlinx.serialization.json.JsonNull) return null
    val value=optionalString(key) ?: throw IllegalArgumentException("Invalid source field $key")
    require(value.length <= 65536 && !value.contains('\u0000')) { "Invalid source field $key" }
    return value
}
private fun JsonObject.optionalInteger(key: String): Int? {
    if (!containsKey(key) || get(key) == kotlinx.serialization.json.JsonNull) return null
    return (get(key) as? JsonPrimitive)?.intOrNull ?: throw IllegalArgumentException("Invalid source span $key")
}

internal fun referenceProvenance(raw: String): NativeDefinitionProvenance {
    val p=referenceMetadata(raw)
    return NativeDefinitionProvenance(raw,p.optionalText("path"),p.optionalText("locator"),p.optionalText("textSha256"),
        p.optionalText("originalSourceSha256"),p.optionalText("databaseSha256"),p.optionalText("inputSha256"),
        p.optionalText("documentId"),p.optionalText("documentVersionId"),p.optionalText("sectionId"),p.optionalText("chunkId"),p.optionalText("anchor"),
        p.optionalInteger("charStart"),p.optionalInteger("charEnd"),p.optionalInteger("pageStart"),p.optionalInteger("pageEnd"),
        p.optionalText("sourceFile"),p.optionalText("sectionTitle"),p.optionalText("parentEntryId"),p.optionalText("parentTitle"),p.optionalInteger("offsetStart"),p.optionalInteger("offsetEnd"))
}

internal fun referenceSource(id: String,title: String,raw: String): NativeDefinitionSource {
    referenceIdentity(id)
    val metadata=referenceMetadata(raw)
    val source=(metadata["source"] as? JsonObject) ?: throw IllegalArgumentException("Missing original source descriptor")
    require((metadata["definitionReference"] as? JsonPrimitive)?.intOrNull == 1 &&
        (metadata["releaseEligible"] as? JsonPrimitive)?.booleanOrNull == false && metadata.string("reviewStatus") == "requires-review") { "Invalid reference source trust boundary" }
    return NativeDefinitionSource(id,title,source.optionalText("sourceType"),source.optionalText("sourceUrl"),source.optionalText("baseUrl"),
        source.optionalText("rightsStatus"),false,metadata.string("reviewStatus"),source.optionalText("sourceSha256"),source.optionalText("fileName"),raw)
}
