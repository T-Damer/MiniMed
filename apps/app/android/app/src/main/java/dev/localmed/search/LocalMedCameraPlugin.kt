package dev.localmed.search

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.provider.MediaStore
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.File

/**
 * Takes a photo with the system camera app (`ACTION_IMAGE_CAPTURE`) instead of the WebView's
 * getUserMedia, which several phones handle badly.
 *
 * The camera writes a JPEG into the app cache (`localmed/camera/<id>.jpg`, shared through the
 * existing FileProvider). The page reads it from there and then calls [discardPhoto]; until then
 * the file stays, so a photo taken while Android killed the WebView process is still there when
 * the app restarts. Capacitor re-delivers that finished call to the page as `appRestoredResult`
 * with the same `id` and `purpose` the page passed in, which is why the file name depends only on
 * the call options.
 *
 * Rejection codes: CAMERA_CANCELLED, CAMERA_DENIED, CAMERA_UNAVAILABLE.
 */
@CapacitorPlugin(
    name = "LocalMedCamera",
    permissions = [Permission(strings = [Manifest.permission.CAMERA], alias = "camera")],
)
class LocalMedCameraPlugin : Plugin() {
    @PluginMethod
    fun capturePhoto(call: PluginCall) {
        if (!CameraCapturePolicy.isValidId(call.getString("id"))) {
            call.reject("Некорректный снимок.")
            return
        }
        if (getPermissionState("camera") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "onCameraPermission")
            return
        }
        launchCamera(call)
    }

    @PermissionCallback
    fun onCameraPermission(call: PluginCall?) {
        if (call == null) return
        if (getPermissionState("camera") == com.getcapacitor.PermissionState.GRANTED) {
            launchCamera(call)
        } else {
            call.reject("Нет доступа к камере.", "CAMERA_DENIED")
        }
    }

    private fun launchCamera(call: PluginCall) {
        val id = call.getString("id") ?: return
        val file = CameraCapturePolicy.photoFile(context.cacheDir, id)
        try {
            val directory = file.parentFile ?: throw IllegalStateException("No camera directory")
            if (!directory.isDirectory && !directory.mkdirs()) {
                throw IllegalStateException("Unable to prepare the camera directory")
            }
            removeStalePhotos(directory, keep = file)
            if (file.exists()) file.delete()
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, uri)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                // Older camera apps only honour the grant through ClipData.
                clipData = ClipData.newRawUri("", uri)
            }
            startActivityForResult(call, intent, "onPhotoCaptured")
        } catch (_: ActivityNotFoundException) {
            call.reject("Приложение камеры не найдено.", "CAMERA_UNAVAILABLE")
        } catch (cause: Exception) {
            call.reject("Не удалось открыть камеру: ${cause.message?.take(120) ?: "ошибка"}")
        }
    }

    @ActivityCallback
    fun onPhotoCaptured(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val id = call.getString("id")
        if (!CameraCapturePolicy.isValidId(id)) {
            call.reject("Некорректный снимок.")
            return
        }
        val file = CameraCapturePolicy.photoFile(context.cacheDir, id!!)
        if (result.resultCode != Activity.RESULT_OK || !file.isFile || file.length() == 0L) {
            file.delete()
            call.reject("Снимок не сделан.", "CAMERA_CANCELLED")
            bridge.releaseCall(call)
            return
        }
        call.resolve(
            JSObject()
                .put("id", id)
                .put("path", file.absolutePath)
                .put("mimeType", "image/jpeg")
                .put("size", file.length())
                .put("purpose", CameraCapturePolicy.normalizePurpose(call.getString("purpose"))),
        )
        bridge.releaseCall(call)
    }

    /** The page has the photo in memory (or does not want it): the file may go. */
    @PluginMethod
    fun discardPhoto(call: PluginCall) {
        val id = call.getString("id")
        if (!CameraCapturePolicy.isValidId(id)) {
            call.reject("Некорректный снимок.")
            return
        }
        CameraCapturePolicy.photoFile(context.cacheDir, id!!).delete()
        call.resolve()
    }

    private fun removeStalePhotos(directory: File, keep: File) {
        val now = System.currentTimeMillis()
        directory.listFiles()?.forEach { candidate ->
            if (candidate != keep && CameraCapturePolicy.isStale(candidate.lastModified(), now)) {
                candidate.delete()
            }
        }
    }
}
