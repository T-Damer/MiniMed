package dev.localmed.nativespike.shared.designsystem

import androidx.compose.ui.Modifier

/**
 * Votes for the display's highest refresh rate for everything drawn inside. On Android 15+ the
 * drawing view votes per frame and Compose otherwise asks for the «normal» category (60 Hz on
 * phones whose high category is 90); other platforms leave it to the system.
 */
expect fun Modifier.nativeHighFrameRate(): Modifier
