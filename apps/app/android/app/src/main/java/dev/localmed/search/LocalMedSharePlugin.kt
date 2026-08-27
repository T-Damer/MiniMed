package dev.localmed.search

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.util.Base64
import androidx.core.content.FileProvider
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

@CapacitorPlugin(name = "LocalMedShare")
class LocalMedSharePlugin : Plugin() {
    private val executor = Executors.newSingleThreadExecutor()

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

    @PluginMethod
    fun shareFile(call: PluginCall) {
        val title = call.getString("title").orEmpty()
        val fileName = call.getString("fileName").orEmpty()
        val mimeType = call.getString("mimeType").orEmpty().ifEmpty { "application/octet-stream" }
        val data = call.getString("data").orEmpty()
        if (fileName.isEmpty() || data.isEmpty()) {
            call.reject("Share file data is required.")
            return
        }
        val hostActivity = activity ?: run {
            call.reject("Activity is not available.")
            return
        }

        executor.execute {
            try {
                val sourceName = File(fileName).name.replace(Regex("[\\u0000-\\u001f]"), "_")
                val extension = sourceName.substringAfterLast('.', "").take(12)
                val suffix = if (extension.isEmpty()) "" else ".$extension"
                val safeName = sourceName.substringBeforeLast('.', sourceName)
                    .take(48 - suffix.length)
                    .ifEmpty { "document" } + suffix
                val directory = File(context.cacheDir, "localmed/share/${UUID.randomUUID()}")
                if (!directory.mkdirs()) throw IllegalStateException("Unable to prepare shared file.")
                val target = File(directory, safeName)
                target.writeBytes(Base64.decode(data, Base64.DEFAULT))
                val uri = FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.fileprovider",
                    target,
                )
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = mimeType
                    putExtra(Intent.EXTRA_SUBJECT, title)
                    putExtra(Intent.EXTRA_STREAM, uri)
                    clipData = ClipData.newRawUri(safeName, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                hostActivity.runOnUiThread {
                    try {
                        hostActivity.startActivity(Intent.createChooser(send, title.ifEmpty { null }))
                        call.resolve()
                    } catch (error: ActivityNotFoundException) {
                        call.reject(error.message ?: "No application can share this file.")
                    }
                }
            } catch (error: Exception) {
                hostActivity.runOnUiThread {
                    call.reject(error.message ?: "Unable to share this file.")
                }
            }
        }
    }
}
