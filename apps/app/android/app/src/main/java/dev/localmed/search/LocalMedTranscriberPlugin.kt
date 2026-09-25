package dev.localmed.search

import android.Manifest
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@CapacitorPlugin(
    name = "LocalMedTranscriber",
    permissions = [
        Permission(alias = "microphone", strings = [Manifest.permission.RECORD_AUDIO]),
    ],
)
class LocalMedTranscriberPlugin : Plugin() {
    private data class ModelSpec(
        val fileName: String,
        val expectedBytes: Long,
        val expectedSha256: String,
    )

    private data class RecordingSession(
        val recorder: MediaRecorder,
        val file: File,
        val fileName: String,
        val mimeType: String,
        val container: String,
        val startedAtMs: Long,
    )

    companion object {
        private const val BUFFER_BYTES = 64 * 1024

        private val MODEL_SPECS =
            listOf(
                    ModelSpec(
                        "gigaam-v3-punct.int8.onnx",
                        224_893_661L,
                        "d5fea8df94263c285e54b21e5774b707c707192d3bdbeffd7b1eb07fb6743b35",
                    ),
                    ModelSpec(
                        "gigaam-v3-punct.tokens.txt",
                        2_007L,
                        "142de7570b3de5b3035ce111a89c228e80e6085273731d944093ddf24fa539cd",
                    ),
                    ModelSpec(
                        "pyannote-segmentation-3.0.int8.onnx",
                        1_540_506L,
                        "d582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d",
                    ),
                    ModelSpec(
                        "campplus-voxceleb-16k.onnx",
                        29_596_978L,
                        "357a834f702b80161e5b981182c038e18553c1f2ca752ed6cec2052365d4129b",
                    ),
                )
                .associateBy { it.fileName }
    }

    private val recordingLock = Any()
    private val transcriptionExecutor = Executors.newSingleThreadExecutor()
    private val transcribing = AtomicBoolean(false)
    private var recording: RecordingSession? = null

    @PluginMethod
    fun inspectModel(call: PluginCall) {
        try {
            val spec = requireModelSpec(call)
            val target = modelFile(spec)
            call.resolve(modelInspection(spec, target))
        } catch (error: Exception) {
            call.reject(
                "Не удалось проверить модель распознавания.",
                "TRANSCRIPTION_MODEL_INSPECTION_FAILED",
                error,
            )
        }
    }

    @PluginMethod
    fun installModelFile(call: PluginCall) {
        try {
            val spec = requireModelSpec(call)
            val source = stagedDownload(call.getString("sourcePath"))
            if (!source.isFile) throw IOException("Downloaded model file is absent.")
            if (source.length() != spec.expectedBytes) {
                throw IOException("Downloaded model size mismatch.")
            }
            if (!spec.expectedSha256.equals(sha256(source), ignoreCase = true)) {
                throw IOException("Downloaded model checksum mismatch.")
            }

            val target = modelFile(spec)
            ensureDirectory(target.parentFile ?: throw IOException("Model directory is absent."))
            val temporary =
                File(
                    target.parentFile,
                    "." + spec.fileName + "." + UUID.randomUUID() + ".tmp",
                )
            try {
                copyFile(source, temporary)
                if (
                    temporary.length() != spec.expectedBytes ||
                        !spec.expectedSha256.equals(sha256(temporary), ignoreCase = true)
                ) {
                    throw IOException("Copied model checksum mismatch.")
                }
                if (target.exists() && !target.delete()) {
                    throw IOException("Unable to replace the existing model.")
                }
                if (!temporary.renameTo(target)) {
                    copyFile(temporary, target)
                    if (!temporary.delete()) temporary.deleteOnExit()
                }
                if (
                    target.length() != spec.expectedBytes ||
                        !spec.expectedSha256.equals(sha256(target), ignoreCase = true)
                ) {
                    target.delete()
                    throw IOException("Installed model checksum mismatch.")
                }
            } finally {
                if (temporary.exists() && !temporary.delete()) temporary.deleteOnExit()
            }
            call.resolve(modelInspection(spec, target))
        } catch (error: Exception) {
            call.reject(
                "Не удалось установить модель распознавания.",
                "TRANSCRIPTION_MODEL_INSTALL_FAILED",
                error,
            )
        }
    }

    @PluginMethod
    fun startRecording(call: PluginCall) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject(
                "Нужен доступ к микрофону.",
                "MICROPHONE_PERMISSION_REQUIRED",
            )
            return
        }
        synchronized(recordingLock) {
            if (recording != null) {
                call.reject("Запись уже идёт.", "RECORDING_ALREADY_ACTIVE")
                return
            }
            try {
                val directory = File(context.filesDir, "localmed/recordings")
                ensureDirectory(directory)
                val opus = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                val extension = if (opus) "ogg" else "m4a"
                val mimeType = if (opus) "audio/ogg;codecs=opus" else "audio/mp4"
                val container = if (opus) "ogg-opus" else "m4a-aac"
                val fileName =
                    "visit-" +
                        System.currentTimeMillis() +
                        "-" +
                        UUID.randomUUID() +
                        "." +
                        extension
                val file = File(directory, fileName)
                if (file.canonicalFile.parentFile != directory.canonicalFile) {
                    throw IOException("Recording path escapes its directory.")
                }

                val recorder = MediaRecorder()
                try {
                    recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
                    if (opus) {
                        recorder.setOutputFormat(MediaRecorder.OutputFormat.OGG)
                        recorder.setAudioEncoder(MediaRecorder.AudioEncoder.OPUS)
                        recorder.setAudioEncodingBitRate(64_000)
                        recorder.setAudioSamplingRate(48_000)
                    } else {
                        recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                        recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                        recorder.setAudioEncodingBitRate(96_000)
                        recorder.setAudioSamplingRate(44_100)
                    }
                    recorder.setAudioChannels(1)
                    recorder.setOutputFile(file.absolutePath)
                    recorder.prepare()
                    recorder.start()
                } catch (error: Exception) {
                    recorder.reset()
                    recorder.release()
                    if (file.exists()) file.delete()
                    throw error
                }
                recording =
                    RecordingSession(
                        recorder = recorder,
                        file = file,
                        fileName = fileName,
                        mimeType = mimeType,
                        container = container,
                        startedAtMs = SystemClock.elapsedRealtime(),
                    )
                call.resolve()
            } catch (error: Exception) {
                call.reject("Не удалось начать запись.", "RECORDING_START_FAILED", error)
            }
        }
    }

    @PluginMethod
    fun stopRecording(call: PluginCall) {
        synchronized(recordingLock) {
            val session = recording
            if (session == null) {
                call.reject("Запись не запущена.", "RECORDING_NOT_ACTIVE")
                return
            }
            recording = null
            val durationMs = (SystemClock.elapsedRealtime() - session.startedAtMs).coerceAtLeast(0L)
            try {
                try {
                    session.recorder.stop()
                } finally {
                    session.recorder.reset()
                    session.recorder.release()
                }
                if (!session.file.isFile || session.file.length() == 0L) {
                    session.file.delete()
                    throw IOException("Recorded audio is empty.")
                }
                val result = JSObject()
                result.put("filePath", session.file.absolutePath)
                result.put("fileName", session.fileName)
                result.put("mimeType", session.mimeType)
                result.put("container", session.container)
                result.put("durationMs", durationMs)
                call.resolve(result)
            } catch (error: Exception) {
                session.file.delete()
                call.reject("Не удалось завершить запись.", "RECORDING_STOP_FAILED", error)
            }
        }
    }

    @PluginMethod
    fun transcribe(call: PluginCall) {
        val path = call.getString("filePath")
        if (path.isNullOrBlank()) {
            call.reject("Путь к записи не указан.", "TRANSCRIPTION_FILE_REQUIRED")
            return
        }
        val file =
            try {
                recordingFile(path)
            } catch (error: Exception) {
                call.reject("Запись недоступна.", "TRANSCRIPTION_FILE_INVALID", error)
                return
            }
        if (!transcribing.compareAndSet(false, true)) {
            call.reject("Распознавание уже выполняется.", "TRANSCRIPTION_ALREADY_ACTIVE")
            return
        }

        transcriptionExecutor.execute {
            try {
                verifyInstalledModels()
                notifyProgress("preparing", 0, 1_000, "Декодируем аудио")
                val decoded =
                    NativeAudioDecoder.decode(file) { completed, total ->
                        notifyProgress("preparing", completed, total, null)
                    }
                notifyProgress("diarizing", 0, 1, "Разделяем спикеров")
                val segments =
                    NativeSherpaTranscriber.transcribe(
                        audio = decoded,
                        modelDirectory = modelDirectory(),
                        onDiarizationProgress = { completed, total ->
                            notifyProgress("diarizing", completed, total, null)
                        },
                        onTranscriptionProgress = { completed, total ->
                            notifyProgress("transcribing", completed, total, null)
                        },
                    )
                notifyProgress("finalizing", 0, 1, "Собираем расшифровку")
                val array = JSArray()
                for (segment in segments) {
                    val value = JSObject()
                    value.put("speakerId", segment.speakerId)
                    value.put("startMs", segment.startMs)
                    value.put("endMs", segment.endMs)
                    value.put("text", segment.text)
                    array.put(value)
                }
                val result = JSObject()
                result.put("language", "ru")
                result.put("durationMs", decoded.durationMs)
                result.put("segments", array)
                notifyProgress("finalizing", 1, 1, null)
                call.resolve(result)
            } catch (error: Exception) {
                call.reject("Не удалось распознать запись.", "TRANSCRIPTION_FAILED", error)
            } catch (error: LinkageError) {
                call.reject(
                    "Нативный runtime распознавания недоступен.",
                    "TRANSCRIPTION_RUNTIME_UNAVAILABLE",
                    Exception(error),
                )
            } finally {
                transcribing.set(false)
            }
        }
    }

    override fun handleOnDestroy() {
        synchronized(recordingLock) {
            val session = recording
            recording = null
            if (session != null) {
                try {
                    session.recorder.stop()
                } catch (_: RuntimeException) {
                    // A very short unfinished capture can reject stop(); cleanup must still continue.
                }
                session.recorder.reset()
                session.recorder.release()
                if (session.file.length() == 0L) session.file.delete()
            }
        }
        transcriptionExecutor.shutdownNow()
        super.handleOnDestroy()
    }

    private fun verifyInstalledModels() {
        for (spec in MODEL_SPECS.values) {
            val file = modelFile(spec)
            if (
                !file.isFile ||
                    file.length() != spec.expectedBytes ||
                    !spec.expectedSha256.equals(sha256(file), ignoreCase = true)
            ) {
                throw IOException(
                    "Required transcription model is missing or invalid: " + spec.fileName,
                )
            }
        }
    }

    private fun notifyProgress(
        stage: String,
        completed: Int,
        total: Int,
        message: String?,
    ) {
        val value = JSObject()
        value.put("stage", stage)
        value.put("completed", completed.coerceAtLeast(0))
        value.put("total", total.coerceAtLeast(1))
        if (!message.isNullOrBlank()) value.put("message", message)
        notifyListeners("transcriptionProgress", value)
    }

    private fun modelDirectory(): File = File(context.filesDir, "localmed/transcription-models")

    private fun requireModelSpec(call: PluginCall): ModelSpec {
        val fileName = call.getString("fileName") ?: throw IOException("Model file name is missing.")
        val spec = MODEL_SPECS[fileName] ?: throw IOException("Unknown transcription model.")
        val requestedBytes =
            call.getLong("expectedBytes") ?: throw IOException("Expected model size is missing.")
        val requestedSha =
            call.getString("expectedSha256")?.lowercase(Locale.ROOT)
                ?: throw IOException("Expected model checksum is missing.")
        if (requestedBytes != spec.expectedBytes || requestedSha != spec.expectedSha256) {
            throw IOException("Model identity does not match the application manifest.")
        }
        return spec
    }

    private fun modelFile(spec: ModelSpec): File = File(modelDirectory(), spec.fileName)

    private fun modelInspection(spec: ModelSpec, file: File): JSObject {
        val valid =
            file.isFile &&
                file.length() == spec.expectedBytes &&
                spec.expectedSha256.equals(sha256(file), ignoreCase = true)
        val result = JSObject()
        result.put("valid", valid)
        result.put("sizeBytes", if (file.isFile) file.length() else 0L)
        return result
    }

    private fun stagedDownload(value: String?): File {
        if (value.isNullOrBlank()) throw IOException("Downloaded model path is missing.")
        val external =
            context.getExternalFilesDir(null) ?: throw IOException("External storage unavailable.")
        val directory = File(external, "minimed-downloads").canonicalFile
        val source = File(value).canonicalFile
        if (source.parentFile != directory || !source.name.matches(Regex("[a-f0-9]{64}\\.part"))) {
            throw IOException("Downloaded model path is outside the staging directory.")
        }
        return source
    }

    private fun recordingFile(value: String): File {
        val directory = File(context.filesDir, "localmed/recordings").canonicalFile
        val file = File(value).canonicalFile
        if (
            file.parentFile != directory ||
                !file.name.matches(Regex("visit-[A-Za-z0-9._-]{1,160}"))
        ) {
            throw IOException("Recording path is outside the app recording directory.")
        }
        if (!file.isFile) throw IOException("Recording file is absent.")
        return file
    }

    private fun ensureDirectory(directory: File) {
        if (!directory.exists() && !directory.mkdirs()) {
            throw IOException("Unable to create app storage directory.")
        }
        if (!directory.isDirectory) throw IOException("App storage path is not a directory.")
    }

    private fun copyFile(source: File, target: File) {
        BufferedInputStream(FileInputStream(source), BUFFER_BYTES).use { input ->
            FileOutputStream(target).use { output ->
                val buffer = ByteArray(BUFFER_BYTES)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    if (read > 0) output.write(buffer, 0, read)
                }
                output.fd.sync()
            }
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        BufferedInputStream(FileInputStream(file), BUFFER_BYTES).use { input ->
            val buffer = ByteArray(BUFFER_BYTES)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                if (read > 0) digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }
}
