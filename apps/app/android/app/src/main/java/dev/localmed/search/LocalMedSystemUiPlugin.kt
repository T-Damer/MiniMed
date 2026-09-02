package dev.localmed.search

import android.content.res.Configuration
import android.graphics.Color
import androidx.core.view.WindowCompat
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "LocalMedSystemUi")
class LocalMedSystemUiPlugin : Plugin() {
    @PluginMethod
    fun setStatusBar(call: PluginCall) {
        val backgroundColor = call.getString("backgroundColor")
        if (backgroundColor == null) {
            call.reject("Status bar background color is required.")
            return
        }
        val parsedBackgroundColor = try {
            Color.parseColor(backgroundColor)
        } catch (_: IllegalArgumentException) {
            call.reject("Invalid status bar background color.")
            return
        }
        val darkIcons = call.getBoolean("darkIcons")
        val hostActivity = activity ?: run {
            call.reject("Activity is not available.")
            return
        }
        hostActivity.runOnUiThread {
            val controller =
                WindowCompat.getInsetsController(hostActivity.window, hostActivity.window.decorView)
            val darkMode =
                (hostActivity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
                    Configuration.UI_MODE_NIGHT_YES
            hostActivity.window.statusBarColor = parsedBackgroundColor
            controller.setAppearanceLightStatusBars(darkIcons ?: !darkMode)
            call.resolve()
        }
    }
}
