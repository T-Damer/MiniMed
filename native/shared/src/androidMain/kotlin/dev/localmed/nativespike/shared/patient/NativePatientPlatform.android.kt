package dev.localmed.nativespike.shared.patient

import java.net.URL
import android.icu.text.Collator
import android.icu.text.BreakIterator
import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.GregorianCalendar
import java.util.Locale
import java.util.TimeZone

internal actual fun nativePatientSingleGrapheme(value: String): Boolean = if(value.isEmpty()) false else BreakIterator.getCharacterInstance(Locale("ru")).run { setText(value);first();next()==value.length&&next()==BreakIterator.DONE }
internal actual fun compareNativePatientText(left: String,right: String): Int = Collator.getInstance(Locale.getDefault()).compare(left,right)
internal actual fun nativePatientLocalDateMillis(year: Int,month: Int,day: Int,hour: Int,minute: Int,second: Int,millisecond: Int): Double? = GregorianCalendar().apply {
    gregorianChange=Date(Long.MIN_VALUE);clear();set(Calendar.ERA,if(year<=0)GregorianCalendar.BC else GregorianCalendar.AD);set(Calendar.YEAR,if(year<=0)1-year else year);set(Calendar.MONTH,month-1);set(Calendar.DAY_OF_MONTH,day);set(Calendar.HOUR_OF_DAY,hour);set(Calendar.MINUTE,minute);set(Calendar.SECOND,second);set(Calendar.MILLISECOND,millisecond)
}.timeInMillis.toDouble()
internal actual fun nativePatientLegacyDateMillis(value: String): Double? {
    val format=when { '/' in value->"M/d/yyyy";',' in value&&value.endsWith(" GMT")->"EEE, dd MMM yyyy HH:mm:ss z";else->"MMMM d, yyyy" }
    val formatter=SimpleDateFormat(format,Locale.US).apply { calendar=GregorianCalendar(TimeZone.getDefault(),Locale.US).apply { gregorianChange=Date(Long.MIN_VALUE) };isLenient=true }
    val position=ParsePosition(0);val result=formatter.parse(value,position)
    return result?.takeIf { position.index==value.length }?.time?.toDouble()
}
internal actual fun nativePatientHttpUrl(value: String): Boolean = try {
    val url=URL(patientUrlForParsing(value));url.protocol.lowercase() in listOf("http","https")&&url.host.isNotEmpty()&&url.port in -1..65535
} catch(_: IllegalArgumentException) { false } catch(_: java.net.MalformedURLException) { false }
