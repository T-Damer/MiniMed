package dev.localmed.nativespike.shared.patient

@JsFun("(value) => Array.from(new Intl.Segmenter('ru', {granularity:'grapheme'}).segment(value)).length === 1")
private external fun singleGrapheme(value: String): Boolean
@JsFun("(left,right) => left.localeCompare(right)")
private external fun compareText(left: String,right: String): Int
@JsFun("(year,month,day,hour,minute,second,millisecond) => { const date = new Date(0); date.setFullYear(year,month-1,day); date.setHours(hour,minute,second,millisecond); return date.getTime(); }")
private external fun localDate(year: Int,month: Int,day: Int,hour: Int,minute: Int,second: Int,millisecond: Int): Double
@JsFun("(value) => Date.parse(value)")
private external fun legacyDate(value: String): Double
@JsFun("(value) => { try { const u=new URL(value);return u.protocol==='http:'||u.protocol==='https:'; } catch { return false; } }")
private external fun httpUrl(value: String): Boolean
internal actual fun nativePatientSingleGrapheme(value: String)=singleGrapheme(value)
internal actual fun compareNativePatientText(left: String,right: String)=compareText(left,right)
internal actual fun nativePatientLocalDateMillis(year: Int,month: Int,day: Int,hour: Int,minute: Int,second: Int,millisecond: Int)=localDate(year,month,day,hour,minute,second,millisecond).takeIf(Double::isFinite)
internal actual fun nativePatientLegacyDateMillis(value: String)=legacyDate(value).takeIf(Double::isFinite)
internal actual fun nativePatientHttpUrl(value: String)=httpUrl(value)
