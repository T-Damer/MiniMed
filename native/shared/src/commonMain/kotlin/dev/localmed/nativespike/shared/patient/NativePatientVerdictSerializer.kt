package dev.localmed.nativespike.shared.patient

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.*

/** TS validates this snapshot without rewriting its defaults or unknown historical source fields. */
internal object NativePatientVerdictSerializer : KSerializer<NativePatientVerdict> {
    override val descriptor: SerialDescriptor=JsonElement.serializer().descriptor
    override fun deserialize(decoder: Decoder): NativePatientVerdict {
        val r=(decoder as JsonDecoder).decodeJsonElement().jsonObject
        return NativePatientVerdict(r.getValue("rangeId").jsonPrimitive.content,r.getValue("title").jsonPrimitive.content,r.getValue("explanation").jsonPrimitive.content,r.getValue("attentionLevel").jsonPrimitive.content,
            r["lowerBound"]?.jsonPrimitive?.double,r["upperBound"]?.jsonPrimitive?.double,r["lowerInclusive"]?.jsonPrimitive?.boolean,r["upperInclusive"]?.jsonPrimitive?.boolean,r["sourceIds"]?.jsonArray?.map { it.jsonPrimitive.content },r)
    }
    override fun serialize(encoder: Encoder,value: NativePatientVerdict) {
        (encoder as JsonEncoder).encodeJsonElement(value.originalRecord ?: buildJsonObject {
            put("rangeId",value.rangeId);put("title",value.title);put("explanation",value.explanation);put("attentionLevel",value.attentionLevel)
            value.lowerBound?.let { put("lowerBound",it) };value.upperBound?.let { put("upperBound",it) }
            value.lowerInclusive?.let { put("lowerInclusive",it) };value.upperInclusive?.let { put("upperInclusive",it) }
            value.sourceIds?.let { put("sourceIds",JsonArray(it.map(::JsonPrimitive))) }
        })
    }
}
