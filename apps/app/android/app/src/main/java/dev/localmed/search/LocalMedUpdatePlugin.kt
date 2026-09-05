package dev.localmed.search

import android.content.Intent
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import org.json.JSONObject

@CapacitorPlugin(name = "LocalMedUpdate")
class LocalMedUpdatePlugin : Plugin() {
    private val updateManager: ApkUpdateManager get() = ApkUpdateRuntime.manager(context)
    private var removeUpdateListener: (() -> Unit)? = null

    override fun load() {
        super.load()
        removeUpdateListener = updateManager.addListener { snapshot ->
            notifyListeners("apkDownloadProgress", snapshot.toJson())
        }
    }

    override fun handleOnDestroy() {
        removeUpdateListener?.invoke()
        removeUpdateListener = null
        super.handleOnDestroy()
    }

    @PluginMethod
    fun startApkDownload(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrBlank()) {
            call.reject("APK URL is required.")
            return
        }
        try {
            val spec = ApkDownloadSpec(
                url = url,
                expectedSha256 = call.getString("expectedSha256"),
                expectedBytes = call.getLong("expectedBytes"),
                releaseVersion = call.getString("releaseVersion"),
            )
            val snapshot = updateManager.start(spec)
            if (snapshot.state != ApkTaskState.READY) {
                try {
                    ApkUpdateScheduler.start(context.applicationContext, snapshot.taskId, spec.expectedBytes)
                } catch (error: Exception) {
                    updateManager.markSchedulingFailed(snapshot.taskId)
                    throw error
                }
            }
            call.resolve(JSObject().put("taskId", snapshot.taskId))
        } catch (error: Exception) {
            call.reject(safeMessage(error))
        }
    }

    @PluginMethod
    fun getApkDownloadStatus(call: PluginCall) {
        val taskId = taskId(call) ?: return
        try {
            call.resolve(updateManager.status(taskId).toJson())
        } catch (error: Exception) {
            call.reject(safeMessage(error))
        }
    }

    @PluginMethod
    fun getLatestApkDownloadStatus(call: PluginCall) {
        val spec = downloadSpec(call) ?: return
        try {
            call.resolve(
                JSObject().put(
                    "status",
                    updateManager.latestStatus(spec)?.toJson() ?: JSONObject.NULL,
                ),
            )
        } catch (error: Exception) {
            call.reject(safeMessage(error))
        }
    }

    @PluginMethod
    fun cancelApkDownload(call: PluginCall) {
        val taskId = taskId(call) ?: return
        try {
            if (updateManager.cancel(taskId).state == ApkTaskState.CANCELLED) {
                ApkUpdateScheduler.cancel(context.applicationContext)
            }
            call.resolve()
        } catch (error: Exception) {
            call.reject(safeMessage(error))
        }
    }

    @PluginMethod
    fun installDownloadedApk(call: PluginCall) {
        val taskId = taskId(call) ?: return
        val host = activity ?: run {
            call.reject("Activity is not available.")
            return
        }
        try {
            val target = updateManager.installableFile(taskId)
            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                target,
            )
            host.runOnUiThread {
                try {
                    val intent = Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(uri, "application/vnd.android.package-archive")
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    host.startActivity(intent)
                    call.resolve()
                } catch (error: Exception) {
                    call.reject(safeMessage(error))
                }
            }
        } catch (error: Exception) {
            call.reject(safeMessage(error))
        }
    }

    private fun taskId(call: PluginCall): String? {
        val value = call.getString("taskId")
        if (value.isNullOrBlank()) {
            call.reject("APK task id is required.")
            return null
        }
        return value
    }

    private fun downloadSpec(call: PluginCall): ApkDownloadSpec? {
        val url = call.getString("url")
        if (url.isNullOrBlank()) {
            call.reject("APK URL is required.")
            return null
        }
        return ApkDownloadSpec(
            url = url,
            expectedSha256 = call.getString("expectedSha256"),
            expectedBytes = call.getLong("expectedBytes"),
            releaseVersion = call.getString("releaseVersion"),
        )
    }

    private fun ApkTaskSnapshot.toJson(): JSObject = JSObject()
        .put("taskId", taskId)
        .put("state", state.wireValue())
        .put("downloadedBytes", downloadedBytes)
        .put("totalBytes", totalBytes ?: JSONObject.NULL)
        .put("errorCode", errorCode ?: JSONObject.NULL)

    private fun safeMessage(error: Exception): String =
        error.message?.take(160) ?: "Unable to update the APK."
}
