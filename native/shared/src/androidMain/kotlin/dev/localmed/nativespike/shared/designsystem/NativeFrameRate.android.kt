package dev.localmed.nativespike.shared.designsystem

import androidx.compose.ui.Modifier
import androidx.compose.ui.preferredFrameRate

/** 120 fps; Android picks the closest rate the display offers. */
actual fun Modifier.nativeHighFrameRate(): Modifier = preferredFrameRate(120f)
