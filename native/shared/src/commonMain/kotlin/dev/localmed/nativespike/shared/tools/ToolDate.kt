package dev.localmed.nativespike.shared.tools

import kotlin.math.floor
import kotlin.math.truncate

/** Gregorian UTC days. JS accepts day 1..31 rollover, while invalid months/zero days reject. */
internal data class ToolDate(val year: Int, val month: Int, val day: Int) {
    val epochDay: Int get() = daysBeforeYear(year) + (1 until month).sumOf { monthDays(year, it) } + day - 1
    fun iso() = "${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}"
    fun sourceIso() = "${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}"
    fun russian() = "$day ${listOf("января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря")[month - 1]} $year г."
    fun addDays(value: Double): ToolDate? {
        // Date TimeClip is evaluated before the calendar conversion; never clamp to Int.MAX_VALUE.
        val milliseconds = (epochDay - unixEpochDay).toDouble() * dayMilliseconds + value * dayMilliseconds
        if (!milliseconds.isFinite() || kotlin.math.abs(milliseconds) > 8.64e15) return null
        return fromDay(floor(truncate(milliseconds) / dayMilliseconds).toInt() + unixEpochDay)
    }
    companion object {
        private const val unixEpochDay = 719528
        private const val dayMilliseconds = 86400000.0
        val pattern = Regex("^\\d{4}-\\d{2}-\\d{2}$")
        fun parse(value: NativeToolInput?, context: String): ToolDate {
            if (value !is NativeToolInput.Text || !pattern.matches(value.value)) throw ToolExpressionError("$context: expected an ISO date string (YYYY-MM-DD).")
            val text = value.value; val year = text.take(4).toInt(); val month = text.substring(5, 7).toInt(); val day = text.takeLast(2).toInt()
            if (month !in 1..12 || day !in 1..31) throw ToolExpressionError("$context: invalid date \"$text\".")
            return fromDay(ToolDate(year, month, 1).epochDay + day - 1)
        }
        private fun daysBeforeYear(year: Int): Int { val y = year.toLong(); return (365 * y + floor((y + 3) / 4.0).toLong() - floor((y + 99) / 100.0).toLong() + floor((y + 399) / 400.0).toLong()).toInt() }
        private fun monthDays(year: Int, month: Int) = when(month) { 2 -> if(year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)) 29 else 28; 4, 6, 9, 11 -> 30; else -> 31 }
        private fun fromDay(epoch: Int): ToolDate {
            var year = floor(epoch / 365.2425).toInt()
            while(daysBeforeYear(year) > epoch) year--
            while(daysBeforeYear(year + 1) <= epoch) year++
            var remaining = epoch - daysBeforeYear(year); var month = 1
            while(remaining >= monthDays(year, month)) { remaining -= monthDays(year, month); month++ }
            return ToolDate(year, month, remaining + 1)
        }
    }
}
