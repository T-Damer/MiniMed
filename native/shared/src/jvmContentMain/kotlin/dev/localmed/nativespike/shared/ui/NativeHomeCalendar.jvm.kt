package dev.localmed.nativespike.shared.ui

import java.time.LocalDate

internal actual fun nativeHomeLocalEpochDay(): Long = LocalDate.now().toEpochDay()
