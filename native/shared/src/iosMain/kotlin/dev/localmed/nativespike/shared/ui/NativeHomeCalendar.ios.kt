@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.tools.ToolDate
import platform.Foundation.NSCalendar
import platform.Foundation.NSCalendarUnitDay
import platform.Foundation.NSCalendarUnitMonth
import platform.Foundation.NSCalendarUnitYear
import platform.Foundation.NSDate

internal actual fun nativeHomeLocalEpochDay(): Long {
    val date = NSCalendar.currentCalendar.components(NSCalendarUnitYear or NSCalendarUnitMonth or NSCalendarUnitDay, NSDate())
    return (ToolDate(date.year.toInt(), date.month.toInt(), date.day.toInt()).epochDay - ToolDate(1970, 1, 1).epochDay).toLong()
}
