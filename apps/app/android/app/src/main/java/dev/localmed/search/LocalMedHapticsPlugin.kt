package dev.localmed.search

import android.os.Build
import android.view.HapticFeedbackConstants
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "LocalMedHaptics")
class LocalMedHapticsPlugin : Plugin() {
    @PluginMethod
    fun impact(call: PluginCall) {
        val style = call.getString("style") ?: run {
            call.reject("Missing haptic style.")
            return
        }
        val constant = hapticConstant(style) ?: run {
            call.reject("Unknown haptic style: $style")
            return
        }
        val activity = activity ?: run {
            call.reject("Activity is not available.")
            return
        }
        activity.runOnUiThread {
            val view = activity.window.decorView
            view.performHapticFeedback(
                constant,
                HapticFeedbackConstants.FLAG_IGNORE_VIEW_SETTING,
            )
            call.resolve()
        }
    }

    private fun hapticConstant(style: String): Int? =
        when (style) {
            "selection" ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    HapticFeedbackConstants.SEGMENT_FREQUENT_TICK
                } else {
                    HapticFeedbackConstants.CLOCK_TICK
                }
            "light" ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    HapticFeedbackConstants.CONTEXT_CLICK
                } else {
                    @Suppress("DEPRECATION")
                    HapticFeedbackConstants.VIRTUAL_KEY
                }
            "medium" ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    HapticFeedbackConstants.CONFIRM
                } else {
                    HapticFeedbackConstants.KEYBOARD_TAP
                }
            "heavy" ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    HapticFeedbackConstants.REJECT
                } else {
                    HapticFeedbackConstants.LONG_PRESS
                }
            else -> null
        }
}
