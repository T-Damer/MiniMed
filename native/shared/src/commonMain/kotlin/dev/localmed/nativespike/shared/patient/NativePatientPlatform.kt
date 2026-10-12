package dev.localmed.nativespike.shared.patient

import dev.localmed.nativespike.shared.text.jsNumberToString
import dev.localmed.nativespike.shared.tools.NativeToolInput
import dev.localmed.nativespike.shared.tools.ToolDate

/** True platform Unicode boundaries; a code point count is not an avatar grapheme count. */
internal expect fun nativePatientSingleGrapheme(value: String): Boolean
internal expect fun compareNativePatientText(left: String, right: String): Int
internal expect fun nativePatientLocalDateMillis(year: Int, month: Int, day: Int, hour: Int, minute: Int, second: Int, millisecond: Int): Double?
internal expect fun nativePatientLegacyDateMillis(value: String): Double?
internal expect fun nativePatientHttpUrl(value: String): Boolean

/** No fallback resets or rewrites when an opaque legacy date is outside the verified grammar. */
class UnsupportedPatientDateFormat : IllegalArgumentException("Формат даты вне проверенного контракта. Исходные данные сохранены; требуется явная проверка формата.")
private val patientWhitespace = Regex("[\\t\\n\\u000b\\u000c\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]")
internal fun String.patientTrim() = trim { patientWhitespace.matches(it.toString()) }
internal fun patientNonEmpty(value: String,label: String) = value.patientTrim().also { require(it.isNotEmpty()) { "$label: значение обязательно." } }
internal fun patientFinite(value: Double,label: String) = value.also { require(it.isFinite()) { "$label: требуется конечное число." } }
internal fun patientPositive(value: Double,label: String) = patientFinite(value,label).also { require(it>0) { "$label: требуется положительное число." } }
internal fun patientMonthDays(year: Int,month: Int) = when(month) { 2->if(year%4==0&&(year%100!=0||year%400==0))29 else 28; 4,6,9,11->30;else->31 }
private val isoDate = Regex("^([0-9]{4}|[+-][0-9]{6})(?:-([0-9]{2})(?:-([0-9]{2}))?)?(?:[Tt ]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\\.([0-9]+))?)?([Zz]|[+-][0-9]{2}:?[0-9]{2})?)?$")
/** JS ISO timestamps (including 24:00 and signed years), plus bounded platform legacy formats. */
internal fun parseNativePatientDate(value: String): Double? {
    val match=isoDate.matchEntire(value)
    if(match==null) {
        if(value.none { it in '0'..'9' })return null
        if(Regex("^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$").matches(value)||Regex("^[A-Za-z]{3}, [0-9]{1,2} [A-Za-z]{3} [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$").matches(value)||Regex("^[A-Za-z]+ [0-9]{1,2}, [0-9]{4}$").matches(value))return nativePatientLegacyDateMillis(value)
        if(Regex("^(?:[0-9]{4}|[+-][0-9]{6})(?:-[0-9]+)*(?:[Tt ].*)?$").matches(value))return null
        throw UnsupportedPatientDateFormat()
    }
    val g=match.groupValues;val year=g[1].toIntOrNull() ?: return null
    if(g[1]=="-000000")return null
    val month=g[2].toIntOrNull() ?: 1; val day=g[3].toIntOrNull() ?: 1
    if(month !in 1..12||day !in 1..31)return null
    val hour=g[4].toIntOrNull() ?: 0;val minute=g[5].toIntOrNull() ?: 0;val second=g[6].toIntOrNull() ?: 0;val milliseconds=g[7].take(3).padEnd(3,'0').toIntOrNull() ?: 0
    if(hour !in 0..24||minute !in 0..59||second !in 0..59||(hour==24&&(minute!=0||second!=0||milliseconds!=0)))return null
    if(g[4].isNotEmpty()&&(g[2].isEmpty()||g[3].isEmpty()))return null
    val result=if(g[4].isNotEmpty()&&g[8].isEmpty())nativePatientLocalDateMillis(year,month,day,hour,minute,second,milliseconds) ?: return null else {
        var offset=0
        if(g[8].isNotEmpty()&&g[8].lowercase()!="z") {
            val zone=g[8].drop(1).replace(":","");val h=zone.take(2).toInt();val m=zone.drop(2).toInt()
            if(h>23||m>59)return null
            offset=(h*60+m)*(if(g[8][0]=='-')-1 else 1)
        }
        (ToolDate(year,month,day).epochDay-ToolDate(1970,1,1).epochDay).toDouble()*86400000.0+hour*3600000.0+minute*60000.0+second*1000+milliseconds-offset*60000.0
    }
    return result.takeIf { it.isFinite()&&kotlin.math.abs(it)<=8.64e15 }
}
internal fun patientAsDate(value: String,label: String): String {
    require(parseNativePatientDate(value)!=null) { "$label: некорректная дата." }
    val calendar=value.take(10);val match=Regex("^([0-9]{4})-([0-9]{2})-([0-9]{2})$").matchEntire(calendar)
    if(match!=null) {
        val year=match.groupValues[1].toInt();val month=match.groupValues[2].toInt();val day=match.groupValues[3].toInt()
        require(year !in 0..99&&month in 1..12&&day in 1..patientMonthDays(year,month)) { "$label: некорректная календарная дата." }
    }
    return value
}
internal fun validatePatientValues(value: NativePatientValues,label: String) {
    require(value.all { (key,entry)->key.patientTrim().isNotEmpty()&&(entry !is NativeToolInput.Number||entry.value.isFinite()) }) { "Повреждён $label." }
}
internal fun patientJsVersion(value: Double)=jsNumberToString(value)
internal fun patientEncodeUriComponent(value: String): String = buildString {
    var index=0
    while(index<value.length) { val c=value[index];if(c.isHighSurrogate()) { require(index+1<value.length&&value[index+1].isLowSurrogate()) { "URI malformed" };index+=2 } else { require(!c.isLowSurrogate()) { "URI malformed" };index++ } }
    value.encodeToByteArray().forEach { byte->val n=byte.toInt() and 255;val c=n.toChar();if(c in 'A'..'Z'||c in 'a'..'z'||c in '0'..'9'||c in "-_.!~*'()")append(c)else { append('%');append("0123456789ABCDEF"[n shr 4]);append("0123456789ABCDEF"[n and 15]) } }
}
fun normalizeNativePatientAvatar(value: NativePatientAvatar): NativePatientAvatar {
    if(value.kind=="symbol") { val symbol=value.value.patientTrim();require(symbol.length<=64&&nativePatientSingleGrapheme(symbol)) { "Выберите один символ или эмодзи." };return value.copy(value=symbol) }
    if(value.kind=="photo") { require(value.value.length<=128*1024&&Regex("^data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$").matches(value.value)) { "Фото пациента должно быть локальной миниатюрой JPEG, PNG или WebP." };return value }
    throw IllegalArgumentException("Некорректный значок пациента.")
}
internal fun patientUrlForParsing(value: String): String {
    val trimmed=value.replace("\t","").replace("\r","").replace("\n","").patientTrim()
    val protocol=Regex("^(https?):",RegexOption.IGNORE_CASE).find(trimmed) ?: return trimmed
    return protocol.groupValues[1].lowercase()+"://"+trimmed.substring(protocol.value.length).trimStart('/').replace('\\','/')
}
