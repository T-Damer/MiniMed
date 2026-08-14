package dev.localmed.search

import android.content.Intent
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

@CapacitorPlugin(name = "LocalMedUpdate")
class LocalMedUpdatePlugin : Plugin() {
    private val executor = Executors.newSingleThreadExecutor()

    @PluginMethod
    fun installApk(call: PluginCall) {
        val source = call.getString("url")
        if (source == null || !source.startsWith("https://", ignoreCase = true)) {
            call.reject("Only HTTPS APK URLs are allowed.")
            return
        }

        executor.execute {
            try {
                val directory = File(context.filesDir, "localmed/updates")
                if (!directory.isDirectory && !directory.mkdirs()) {
                    throw IllegalStateException("Unable to create the update directory.")
                }
                val target = File(directory, "minimed-update.apk")
                val connection = URL(source).openConnection() as HttpURLConnection
                connection.connectTimeout = 20_000
                connection.readTimeout = 60_000
                connection.instanceFollowRedirects = true
                connection.connect()
                if (connection.responseCode !in 200..299) {
                    throw IllegalStateException("APK download failed: HTTP ${connection.responseCode}")
                }
                connection.inputStream.use { input ->
                    FileOutputStream(target).use { output -> input.copyTo(output, 64 * 1024) }
                }
                connection.disconnect()

                val uri = FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.fileprovider",
                    target,
                )
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                activity.runOnUiThread {
                    getActivity().startActivity(intent)
                    call.resolve(JSObject().put("path", target.absolutePath))
                }
            } catch (error: Exception) {
                activity.runOnUiThread {
                    call.reject(error.message ?: "Unable to install the APK.")
                }
            }
        }
    }
}
