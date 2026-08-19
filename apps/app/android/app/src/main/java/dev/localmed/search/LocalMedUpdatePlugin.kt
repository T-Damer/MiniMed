package dev.localmed.search

import android.content.Intent
import android.util.Base64
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors

@CapacitorPlugin(name = "LocalMedUpdate")
class LocalMedUpdatePlugin : Plugin() {
    private val executor = Executors.newSingleThreadExecutor()

    @PluginMethod
    fun prepareApkFile(call: PluginCall) {
        executor.execute {
            try {
                val target = apkFile()
                if (target.exists() && !target.delete()) {
                    throw IllegalStateException("Unable to replace the previous update file.")
                }
                FileOutputStream(target).close()
                activity.runOnUiThread {
                    call.resolve(JSObject().put("path", target.absolutePath))
                }
            } catch (error: Exception) {
                rejectOnUi(call, error)
            }
        }
    }

    @PluginMethod
    fun appendApkChunk(call: PluginCall) {
        val chunk = call.getString("chunk")
        if (chunk.isNullOrEmpty()) {
            call.reject("APK chunk is required.")
            return
        }

        executor.execute {
            try {
                val target = apkFile()
                if (!target.isFile) {
                    throw IllegalStateException("Prepare the APK file before appending chunks.")
                }
                val bytes = Base64.decode(chunk, Base64.DEFAULT)
                FileOutputStream(target, true).use { output ->
                    output.write(bytes)
                }
                activity.runOnUiThread {
                    call.resolve(JSObject().put("bytes", target.length()))
                }
            } catch (error: Exception) {
                rejectOnUi(call, error)
            }
        }
    }

    @PluginMethod
    fun installPreparedApk(call: PluginCall) {
        executor.execute {
            try {
                val target = apkFile()
                if (!target.isFile || target.length() == 0L) {
                    throw IllegalStateException("No downloaded APK is ready to install.")
                }
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
                rejectOnUi(call, error)
            }
        }
    }

    private fun apkFile(): File {
        val directory = File(context.filesDir, "localmed/updates")
        if (!directory.isDirectory && !directory.mkdirs()) {
            throw IllegalStateException("Unable to create the update directory.")
        }
        return File(directory, "minimed-update.apk")
    }

    private fun rejectOnUi(call: PluginCall, error: Exception) {
        activity.runOnUiThread {
            call.reject(error.message ?: "Unable to install the APK.")
        }
    }
}
