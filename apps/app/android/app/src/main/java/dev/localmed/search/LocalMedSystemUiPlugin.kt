package dev.localmed.search

import android.content.res.Configuration
import android.graphics.Color
import android.webkit.JavascriptInterface
import androidx.core.view.WindowCompat
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "LocalMedSystemUi")
class LocalMedSystemUiPlugin : Plugin() {
    /**
     * `window.MiniMedBoot` for the boot surface in index.html. A JavaScript interface rather than
     * plugin methods: plugin calls share one background thread with the database plugin, which is
     * busy opening the core at start-up. Added in load(), before the first page loads.
     */
    private inner class BootBridge {
        @Volatile private var shiftY = 0f

        init {
            val webView = bridge.webView
            webView.addOnLayoutChangeListener { view, _, _, _, _, _, _, _, _ ->
                val location = IntArray(2)
                view.getLocationOnScreen(location)
                val screenHeight = view.rootView.height
                val viewCenter = location[1] + view.height / 2f
                shiftY = (screenHeight / 2f - viewCenter) / view.resources.displayMetrics.density
            }
        }

        /** The page's first screen is ready under its boot surface: the native splash may leave. */
        @JavascriptInterface
        fun ready() {
            (activity as? MainActivity)?.markWebBootReady()
        }

        /** CSS px from the WebView's centre to the screen's, where the native splash icon sits. */
        @JavascriptInterface
        fun iconShiftY(): Float = shiftY
    }

    override fun load() {
        bridge.webView.addJavascriptInterface(BootBridge(), "MiniMedBoot")
    }

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
