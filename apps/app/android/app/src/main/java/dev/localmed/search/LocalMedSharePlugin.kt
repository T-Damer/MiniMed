package dev.localmed.search

import android.content.ActivityNotFoundException
import android.content.Intent
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "LocalMedShare")
class LocalMedSharePlugin : Plugin() {
    @PluginMethod
    fun shareText(call: PluginCall) {
        val title = call.getString("title").orEmpty()
        val text = call.getString("text").orEmpty()
        if (title.isEmpty() && text.isEmpty()) {
            call.reject("Share text is required.")
            return
        }
        val activity = activity ?: run {
            call.reject("Activity is not available.")
            return
        }
        activity.runOnUiThread {
            try {
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_SUBJECT, title)
                    putExtra(Intent.EXTRA_TEXT, text.ifEmpty { title })
                }
                activity.startActivity(Intent.createChooser(send, title.ifEmpty { null }))
                call.resolve()
            } catch (error: ActivityNotFoundException) {
                call.reject(error.message ?: "No application can share this text.")
            }
        }
    }
}
