package dev.localmed.search

import com.arm.aichat.AiChat
import com.arm.aichat.InferenceEngine
import com.arm.aichat.UnsupportedArchitectureException
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.CancellationException
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.runBlocking

/**
 * Native GGUF inference over a vendored llama.cpp (see
 * docs/adr/0015-native-llama-cpp-android-runtime.md), wrapping Arm's `InferenceEngine` JNI bridge
 * (apps/app/android/app/src/main/cpp/, MIT-licensed, adapted from llama.cpp's own
 * examples/llama.android). Unlike the Cactus attempt this superseded, this plugin loads plain
 * GGUF files straight from disk — the same artifacts wllama-web already downloads — with no
 * proprietary conversion step.
 *
 * Download/checksum handling mirrors LocalMedDatabasePlugin.installAssetIfNeeded's idiom: stream
 * to disk with SHA-256 verification and resumable Range requests, never trusting the model bytes
 * to survive a round trip across the JSON-serializing Capacitor bridge.
 */
@CapacitorPlugin(name = "LlamaInference")
class LlamaInferencePlugin : Plugin() {
    private val modelLock = Any()
    private var engine: InferenceEngine? = null
    private val downloadCancelled = AtomicBoolean(false)

    @PluginMethod
    fun ensureModel(call: PluginCall) {
        val fileName = call.getString("fileName")
        val expectedSha256 = normalizeChecksum(call.getString("expectedSha256"))
        val expectedBytes = call.getLong("expectedBytes") ?: 0L
        val urls = listOfNotNull(call.getString("mirrorUrl"), call.getString("url")).filter { it.isNotBlank() }

        if (fileName == null || !SAFE_FILE_NAME.matches(fileName)) {
            call.reject("Invalid model file name.")
            return
        }
        if (expectedSha256 == null || expectedSha256.length != 64) {
            call.reject("A SHA-256 checksum is required for the model artifact.")
            return
        }
        if (urls.isEmpty()) {
            call.reject("At least one download URL is required.")
            return
        }

        downloadCancelled.set(false)
        try {
            val target = ensureModelFile(urls, fileName, expectedSha256, expectedBytes) { loaded, total ->
                val event = JSObject()
                event.put("loaded", loaded)
                event.put("total", total)
                notifyListeners("downloadProgress", event)
            }
            val result = JSObject()
            result.put("path", target.absolutePath)
            call.resolve(result)
        } catch (error: CancellationException) {
            call.reject("Model download cancelled.")
        } catch (error: Exception) {
            call.reject("Unable to download model: ${safeMessage(error)}")
        }
    }

    @PluginMethod
    fun cancelEnsureModel(call: PluginCall) {
        downloadCancelled.set(true)
        call.resolve()
    }

    @PluginMethod
    fun initializeModel(call: PluginCall) {
        val path = call.getString("path")
        if (path == null || !File(path).isFile) {
            call.reject("The model file does not exist; call ensureModel first.")
            return
        }
        synchronized(modelLock) {
            try {
                unloadLocked()
                val instance = AiChat.getInferenceEngine(context)
                runBlocking { instance.loadModel(path) }
                engine = instance
                call.resolve()
            } catch (error: UnsupportedArchitectureException) {
                engine = null
                call.reject("This model's architecture is not supported by the native engine.")
            } catch (error: Exception) {
                engine = null
                call.reject("Unable to initialize the native model: ${safeMessage(error)}")
            }
        }
    }

    @PluginMethod
    fun complete(call: PluginCall) {
        val systemPrompt = call.getString("systemPrompt") ?: ""
        val userPrompt = call.getString("userPrompt") ?: ""
        val maxTokens = call.getInt("maxTokens") ?: 256

        val instance = synchronized(modelLock) { engine }
        if (instance == null) {
            call.reject("No native model is initialized.")
            return
        }
        try {
            val text = runBlocking {
                if (systemPrompt.isNotBlank()) instance.setSystemPrompt(systemPrompt)
                val builder = StringBuilder()
                instance.sendUserPrompt(userPrompt, maxTokens).collect { token -> builder.append(token) }
                builder.toString().trim()
            }
            val result = JSObject()
            result.put("text", text)
            call.resolve(result)
        } catch (error: Exception) {
            call.reject("Native completion failed: ${safeMessage(error)}")
        }
    }

    @PluginMethod
    fun unload(call: PluginCall) {
        synchronized(modelLock) { unloadLocked() }
        call.resolve()
    }

    private fun unloadLocked() {
        val instance = engine ?: return
        engine = null
        try {
            instance.cleanUp()
        } catch (error: Exception) {
            // Best-effort: the engine reference is already cleared either way.
        }
    }

    private fun ensureModelFile(
        urls: List<String>,
        fileName: String,
        expectedSha256: String,
        expectedBytes: Long,
        onProgress: (loaded: Long, total: Long) -> Unit,
    ): File {
        val directory = File(context.filesDir, "localmed/models")
        if (!directory.isDirectory && !directory.mkdirs()) {
            throw IOException("Unable to create native model directory.")
        }
        val target = File(directory, fileName)
        val checksumMarker = File(directory, "$fileName.sha256")
        val partial = File(directory, "$fileName.part")

        if (target.isFile && expectedSha256 == readMarker(checksumMarker)) {
            onProgress(expectedBytes, expectedBytes)
            return target
        }

        var lastError: Exception? = null
        for (url in urls) {
            try {
                downloadWithResume(url, partial, expectedBytes, onProgress)
                val actualSha256 = sha256(partial)
                if (actualSha256 != expectedSha256) {
                    deleteBestEffort(partial)
                    throw IOException("Model checksum mismatch.")
                }
                deleteBestEffort(target)
                if (!partial.renameTo(target)) {
                    throw IOException("Unable to install the downloaded model.")
                }
                writeMarker(checksumMarker, expectedSha256)
                return target
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                lastError = error
            }
        }
        throw lastError ?: IOException("Unable to download the model from any source.")
    }

    private fun downloadWithResume(
        urlString: String,
        destination: File,
        expectedBytes: Long,
        onProgress: (Long, Long) -> Unit,
    ) {
        var attempt = 0
        while (true) {
            attempt += 1
            if (downloadCancelled.get()) throw CancellationException("Model download cancelled.")
            val existingBytes = if (destination.isFile) destination.length() else 0L
            var connection: HttpURLConnection? = null
            try {
                connection = (URL(urlString).openConnection() as HttpURLConnection).apply {
                    connectTimeout = CONNECT_TIMEOUT_MS
                    readTimeout = READ_TIMEOUT_MS
                    if (existingBytes > 0) setRequestProperty("Range", "bytes=$existingBytes-")
                }
                connection.connect()
                val status = connection.responseCode
                if (status !in 200..299) throw IOException("HTTP $status downloading model.")

                val resumed = existingBytes > 0 && status == HttpURLConnection.HTTP_PARTIAL
                if (existingBytes > 0 && !resumed) destination.delete()
                val startBytes = if (resumed) existingBytes else 0L
                val contentLength = connection.contentLengthLong
                val totalBytes = if (contentLength > 0) startBytes + contentLength else expectedBytes

                FileOutputStream(destination, resumed).use { output ->
                    connection.inputStream.use { input ->
                        val buffer = ByteArray(BUFFER_SIZE)
                        var loaded = startBytes
                        while (true) {
                            if (downloadCancelled.get()) throw CancellationException("Model download cancelled.")
                            val read = input.read(buffer)
                            if (read < 0) break
                            output.write(buffer, 0, read)
                            loaded += read
                            onProgress(loaded, totalBytes)
                        }
                    }
                }
                return
            } catch (error: CancellationException) {
                throw error
            } catch (error: IOException) {
                if (attempt >= MAX_ATTEMPTS) throw error
                Thread.sleep(backoffMs(attempt))
            } finally {
                connection?.disconnect()
            }
        }
    }

    companion object {
        private const val BUFFER_SIZE = 64 * 1024
        private const val CONNECT_TIMEOUT_MS = 30_000
        private const val READ_TIMEOUT_MS = 30_000
        private const val MAX_ATTEMPTS = 5
        private val SAFE_FILE_NAME = Regex("[A-Za-z0-9._-]{1,200}")

        private fun backoffMs(attempt: Int): Long = (500L * (1 shl (attempt - 1))).coerceAtMost(8_000L)

        private fun normalizeChecksum(value: String?): String? {
            if (value == null) return null
            val normalized = value.trim().lowercase(Locale.ROOT)
            return if (normalized.startsWith("sha256:")) normalized.substring(7) else normalized
        }

        private fun sha256(file: File): String {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().buffered().use { input ->
                val buffer = ByteArray(BUFFER_SIZE)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    digest.update(buffer, 0, read)
                }
            }
            return digest.digest().joinToString("") { "%02x".format(it) }
        }

        private fun readMarker(marker: File): String? {
            if (!marker.isFile) return null
            return marker.readText(Charsets.US_ASCII).trim().ifEmpty { null }
        }

        private fun writeMarker(marker: File, checksum: String) {
            marker.writeText("$checksum\n", Charsets.US_ASCII)
        }

        private fun deleteBestEffort(file: File) {
            if (file.exists()) file.delete()
        }

        private fun safeMessage(error: Exception): String {
            val message = error.message
            return if (message.isNullOrBlank()) error.javaClass.simpleName else message
        }
    }
}
