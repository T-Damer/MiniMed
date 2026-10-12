@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
package dev.localmed.nativespike.shared.patient

import kotlinx.cinterop.useContents
import platform.Foundation.*

internal actual fun nativePatientSingleGrapheme(value: String): Boolean = value.isNotEmpty()&&(value as NSString).rangeOfComposedCharacterSequenceAtIndex(0u).useContents { length.toInt()==value.length }
internal actual fun compareNativePatientText(left: String,right: String): Int = (left as NSString).localizedCompare(right).toInt()
internal actual fun nativePatientLocalDateMillis(year: Int,month: Int,day: Int,hour: Int,minute: Int,second: Int,millisecond: Int): Double? {
    val calendar=NSCalendar(NSCalendarIdentifierGregorian).apply { timeZone=NSTimeZone.localTimeZone }
    val components=NSDateComponents().apply { era=if(year<=0)0 else 1;this.year=(if(year<=0)1-year else year).toLong();this.month=month.toLong();this.day=day.toLong();this.hour=hour.toLong();this.minute=minute.toLong();this.second=second.toLong();nanosecond=millisecond*1000000L }
    return calendar.dateFromComponents(components)?.timeIntervalSince1970?.times(1000)
}
internal actual fun nativePatientLegacyDateMillis(value: String): Double? {
    val format=when { '/' in value->"M/d/yyyy";value.endsWith(" GMT")->"EEE, dd MMM yyyy HH:mm:ss zzz";else->"MMMM d, yyyy" }
    return NSDateFormatter().apply { locale=NSLocale("en_US_POSIX");dateFormat=format;timeZone=NSTimeZone.localTimeZone;lenient=true }.dateFromString(value)?.timeIntervalSince1970?.times(1000)
}
internal actual fun nativePatientHttpUrl(value: String): Boolean { val url=NSURL.URLWithString(patientUrlForParsing(value)) ?: return false;return url.scheme?.lowercase() in listOf("http","https")&&!url.host.isNullOrEmpty()&&(url.port?.intValue?.let { it in 0..65535 } ?: true) }
