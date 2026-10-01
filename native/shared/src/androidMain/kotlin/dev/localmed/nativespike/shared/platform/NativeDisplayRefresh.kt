package dev.localmed.nativespike.shared.platform

import android.app.Activity
import android.os.Build
import android.view.Display
import android.view.View

/** The fastest display mode at the current physical resolution, so the resolution never changes. */
private fun fastestModeAtCurrentResolution(display: Display): Display.Mode {
    val current = display.mode
    return display.supportedModes
        .filter { it.physicalWidth == current.physicalWidth && it.physicalHeight == current.physicalHeight }
        .maxByOrNull { it.refreshRate } ?: current
}

/**
 * Asks for the display's highest refresh rate, as the WebView app's MainActivity does. Call from
 * `onResume`. These are preferences: Android keeps battery, thermal and user limits. HyperOS
 * ignores `preferredRefreshRate` alone but honours an explicit mode id; Android 15+ also gets the
 * high frame-rate category so an idle Compose surface is not classified as low-rate.
 */
fun Activity.requestHighestRefreshRate() {
    @Suppress("DEPRECATION")
    val display = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) display ?: windowManager.defaultDisplay else windowManager.defaultDisplay
    val fastest = fastestModeAtCurrentResolution(display)
    val attributes = window.attributes
    attributes.preferredRefreshRate = fastest.refreshRate
    attributes.preferredDisplayModeId = fastest.modeId
    window.attributes = attributes
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
        window.setFrameRatePowerSavingsBalanced(false)
        window.decorView.requestedFrameRate = View.REQUESTED_FRAME_RATE_CATEGORY_HIGH
    }
}
