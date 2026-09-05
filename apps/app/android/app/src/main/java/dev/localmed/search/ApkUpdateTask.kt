package dev.localmed.search

import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import java.util.Locale
import java.util.Properties
import java.util.UUID
import java.util.concurrent.CancellationException
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.atomic.AtomicBoolean

private const val APK_MAX_RETRY_ATTEMPTS = 3

internal enum class ApkTaskState {
    DOWNLOADING,
    VERIFYING,
    READY,
    FAILED,
    CANCELLED,
    ;

    fun wireValue(): String = name.lowercase(Locale.ROOT)

    companion object {
        fun fromWireValue(value: String): ApkTaskState? =
            values().firstOrNull { it.wireValue() == value }
    }
}

internal data class ApkDownloadSpec(
    val url: String,
    val expectedSha256: String?,
    val expectedBytes: Long?,
    val releaseVersion: String? = null,
)

internal data class ApkResumeMetadata(
    val etag: String? = null,
    val lastModified: String? = null,
)

internal data class ApkTaskSnapshot(
    val taskId: String,
    val state: ApkTaskState,
    val downloadedBytes: Long,
    val totalBytes: Long?,
    val errorCode: String?,
)

internal data class ApkDownloadedFile(
    val file: File,
    val downloadedBytes: Long,
    val totalBytes: Long?,
    val resumeMetadata: ApkResumeMetadata,
)

internal class ApkDownloadException(
    val code: String,
    message: String,
) : IOException(message)

internal class ApkDownloadControl {
    val cancelled = AtomicBoolean(false)
    val stopped = AtomicBoolean(false)
}

internal enum class ApkRunOutcome {
    READY,
    RETRY,
    FAILED,
    CANCELLED,
    SKIPPED,
}

internal data class ApkRunResult(
    val outcome: ApkRunOutcome,
    val retryDelayMs: Long = 0L,
) {
    val shouldRetry: Boolean get() = outcome == ApkRunOutcome.RETRY
}

/** Streams an APK into an app-private file; it never accepts a caller-provided destination. */
internal class ApkFileDownloader(
    private val openConnection: (URL) -> HttpURLConnection = { url ->
        url.openConnection() as? HttpURLConnection
            ?: throw ApkDownloadException("invalid_connection", "APK URL did not open an HTTP connection.")
    },
    private val availableBytes: (File) -> Long = { file -> file.usableSpace },
) {
    fun validate(spec: ApkDownloadSpec): ApkDownloadSpec {
        val url = httpsUrl(spec.url)
        val checksum = normalizeChecksum(spec.expectedSha256)
        val releaseVersion = normalizeReleaseVersion(spec.releaseVersion)
        if (spec.expectedBytes != null && spec.expectedBytes <= 0L) {
            throw ApkDownloadException("invalid_size", "APK size must be positive.")
        }
        return spec.copy(
            url = url.toExternalForm(),
            expectedSha256 = checksum,
            releaseVersion = releaseVersion,
        )
    }

    fun download(
        spec: ApkDownloadSpec,
        partial: File,
        target: File,
        resumeMetadata: ApkResumeMetadata,
        control: ApkDownloadControl,
        onProgress: (Long, Long?) -> Unit,
        onVerifying: () -> Unit,
        onResponseMetadata: (ApkResumeMetadata) -> Unit,
    ): ApkDownloadedFile {
        val normalized = validate(spec)
        val parent = partial.parentFile?.canonicalFile
            ?: throw ApkDownloadException("invalid_destination", "APK temporary directory is unavailable.")
        if (parent != target.parentFile?.canonicalFile) {
            throw ApkDownloadException("invalid_destination", "APK files must share one private directory.")
        }
        if (target.exists() && !target.delete()) {
            throw ApkDownloadException("write_failed", "Unable to replace the unfinished APK file.")
        }

        var restarts = 0
        while (true) {
            throwIfStopped(control)
            val existing = preparePartial(partial, normalized, control)
            var offset = existing.bytes
            var digest = existing.digest
            var connection: HttpURLConnection? = null
            try {
                connection = openWithHttpsRedirects(
                    httpsUrl(normalized.url),
                    offset,
                    resumeMetadata,
                )
                when (val status = connection.responseCode) {
                    HttpURLConnection.HTTP_OK -> {
                        if (offset > 0L) {
                            truncate(partial)
                            offset = 0L
                            digest = MessageDigest.getInstance("SHA-256")
                        }
                    }
                    HttpURLConnection.HTTP_PARTIAL -> {
                        if (offset == 0L) {
                            throw ApkDownloadException("invalid_range", "APK server returned a partial response without a range.")
                        }
                        val range = parseContentRange(connection.getHeaderField("Content-Range"))
                        if (
                            range.start != offset ||
                                range.end < range.start ||
                                (range.total != null && range.end >= range.total)
                        ) {
                            throw ApkDownloadException("invalid_range", "APK response range does not match the partial file.")
                        }
                        val received = range.end - range.start + 1L
                        val contentLength = connection.contentLengthLong.takeIf { it >= 0L }
                        if (contentLength != null && contentLength != received) {
                            throw ApkDownloadException("invalid_range", "APK response length does not match its range.")
                        }
                        if (normalized.expectedBytes != null && range.total != normalized.expectedBytes) {
                            throw ApkDownloadException("size_mismatch", "APK response size does not match the release asset.")
                        }
                        if (
                            resumeValidatorChanged(resumeMetadata, connection) ||
                                (resumeMetadata.etag == null &&
                                    resumeMetadata.lastModified == null)
                        ) {
                            if (restarts >= 1) {
                                throw ApkDownloadException("artifact_changed", "APK release asset changed while resuming.")
                            }
                            truncate(partial)
                            restarts += 1
                            continue
                        }
                    }
                    HTTP_RANGE_NOT_SATISFIABLE -> {
                        if (canFinalizePartial(normalized, offset, digest)) {
                            onVerifying()
                            return finalizeDownload(
                                partial,
                                target,
                                offset,
                                normalized.expectedBytes,
                                resumeMetadata,
                                control,
                            )
                        }
                        if (restarts >= 1) {
                            throw ApkDownloadException("invalid_range", "APK server rejected the saved partial file.")
                        }
                        truncate(partial)
                        restarts += 1
                        continue
                    }
                    else -> throw ApkDownloadException("http_$status", "APK download returned HTTP $status.")
                }

                val contentLength = connection.contentLengthLong.takeIf { it >= 0L }
                val totalBytes = when (connection.responseCode) {
                    HttpURLConnection.HTTP_PARTIAL -> parseContentRange(
                        connection.getHeaderField("Content-Range"),
                    ).total
                    else -> contentLength ?: normalized.expectedBytes
                }
                if (
                    connection.responseCode == HttpURLConnection.HTTP_OK &&
                    normalized.expectedBytes != null &&
                    contentLength != null &&
                    contentLength != normalized.expectedBytes
                ) {
                    throw ApkDownloadException("size_mismatch", "APK response length does not match the release asset.")
                }
                if (totalBytes != null && normalized.expectedBytes != null && totalBytes != normalized.expectedBytes) {
                    throw ApkDownloadException("size_mismatch", "APK response size does not match the release asset.")
                }
                ensureSpace(parent, contentLength ?: (normalized.expectedBytes?.minus(offset)))
                val nextResumeMetadata = ApkResumeMetadata(
                    etag = safeValidator(connection.getHeaderField("ETag")),
                    lastModified = safeValidator(connection.getHeaderField("Last-Modified")),
                )
                onResponseMetadata(nextResumeMetadata)
                var downloadedBytes = offset
                onProgress(downloadedBytes, totalBytes)

                openOutput(partial, append = offset > 0L).use { output ->
                    connection.inputStream.buffered(BUFFER_BYTES).use { input ->
                        val buffer = ByteArray(BUFFER_BYTES)
                        while (true) {
                            throwIfStopped(control)
                            val read = try {
                                input.read(buffer)
                            } catch (error: IOException) {
                                throw ApkDownloadException("download_failed", error.message ?: "APK download interrupted.")
                            }
                            if (read < 0) break
                            try {
                                output.write(buffer, 0, read)
                            } catch (error: IOException) {
                                throw ApkDownloadException("write_failed", error.message ?: "Unable to write the APK.")
                            }
                            digest.update(buffer, 0, read)
                            downloadedBytes += read
                            onProgress(downloadedBytes, totalBytes)
                        }
                    }
                    try {
                        output.flush()
                        output.fd.sync()
                    } catch (error: IOException) {
                        throw ApkDownloadException("write_failed", error.message ?: "Unable to write the APK.")
                    }
                }

                if (downloadedBytes == 0L) {
                    throw ApkDownloadException("empty_response", "APK download was empty.")
                }
                throwIfStopped(control)
                onVerifying()
                verifyDownload(normalized, downloadedBytes, totalBytes, digest)
                throwIfStopped(control)
                return finalizeDownload(
                    partial,
                    target,
                    downloadedBytes,
                    totalBytes,
                    nextResumeMetadata,
                    control,
                )
            } finally {
                connection?.disconnect()
            }
        }
    }

    private fun preparePartial(
        partial: File,
        spec: ApkDownloadSpec,
        control: ApkDownloadControl,
    ): ExistingPartial {
        var bytes = if (partial.isFile) partial.length() else 0L
        if (spec.expectedBytes != null && bytes > spec.expectedBytes) {
            truncate(partial)
            bytes = 0L
        }
        val digest = MessageDigest.getInstance("SHA-256")
        if (bytes > 0L) {
            FileInputStream(partial).buffered(BUFFER_BYTES).use { input ->
                val buffer = ByteArray(BUFFER_BYTES)
                while (true) {
                    throwIfStopped(control)
                    val read = input.read(buffer)
                    if (read < 0) break
                    digest.update(buffer, 0, read)
                }
            }
        }
        return ExistingPartial(bytes, digest)
    }

    private fun canFinalizePartial(
        spec: ApkDownloadSpec,
        bytes: Long,
        digest: MessageDigest,
    ): Boolean {
        if (
            spec.expectedBytes == null ||
                spec.expectedSha256 == null ||
                bytes != spec.expectedBytes
        ) return false
        return digest.digestHex() == spec.expectedSha256
    }

    private fun verifyDownload(
        spec: ApkDownloadSpec,
        bytes: Long,
        responseTotalBytes: Long?,
        digest: MessageDigest,
    ) {
        if (responseTotalBytes != null && bytes != responseTotalBytes) {
            throw ApkDownloadException("size_mismatch", "APK response ended before the declared size.")
        }
        if (spec.expectedBytes != null && bytes != spec.expectedBytes) {
            throw ApkDownloadException("size_mismatch", "APK size does not match the release asset.")
        }
        if (spec.expectedSha256 != null && digest.digestHex() != spec.expectedSha256) {
            throw ApkDownloadException("checksum_mismatch", "APK checksum does not match the release asset.")
        }
    }

    private fun finalizeDownload(
        partial: File,
        target: File,
        downloadedBytes: Long,
        totalBytes: Long?,
        resumeMetadata: ApkResumeMetadata,
        control: ApkDownloadControl,
    ): ApkDownloadedFile {
        throwIfStopped(control)
        if (!partial.renameTo(target)) {
            throw ApkDownloadException("write_failed", "Unable to finalize the APK file.")
        }
        return ApkDownloadedFile(target, downloadedBytes, totalBytes, resumeMetadata)
    }

    private fun openWithHttpsRedirects(
        initial: URL,
        offset: Long,
        resumeMetadata: ApkResumeMetadata,
    ): HttpURLConnection {
        var current = initial
        for (attempt in 0..MAX_REDIRECTS) {
            val connection = openConnection(current).apply {
                instanceFollowRedirects = false
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                setRequestProperty("Accept-Encoding", "identity")
                if (offset > 0L) {
                    setRequestProperty("Range", "bytes=$offset-")
                    val validator = resumeMetadata.etag ?: resumeMetadata.lastModified
                    if (validator != null) setRequestProperty("If-Range", validator)
                }
            }
            try {
                val status = connection.responseCode
                if (status !in REDIRECT_STATUSES) return connection
                if (attempt == MAX_REDIRECTS) {
                    throw ApkDownloadException("too_many_redirects", "APK download redirected too many times.")
                }
                val location = connection.getHeaderField("Location")
                    ?: throw ApkDownloadException("invalid_redirect", "APK redirect is missing a location.")
                current = redirectUrl(current, location)
            } catch (error: Exception) {
                connection.disconnect()
                throw error
            }
            connection.disconnect()
        }
        throw ApkDownloadException("too_many_redirects", "APK download redirected too many times.")
    }

    private fun parseContentRange(value: String?): ContentRange {
        val match = CONTENT_RANGE.matchEntire(value ?: "")
            ?: throw ApkDownloadException("invalid_range", "APK response has an invalid content range.")
        val start = match.groupValues[1].toLongOrNull()
            ?: throw ApkDownloadException("invalid_range", "APK response has an invalid content range.")
        val end = match.groupValues[2].toLongOrNull()
            ?: throw ApkDownloadException("invalid_range", "APK response has an invalid content range.")
        val total = match.groupValues[3].takeUnless { it == "*" }?.toLongOrNull()
        return ContentRange(start, end, total)
    }

    private fun redirectUrl(current: URL, location: String): URL {
        val resolved = try {
            current.toURI().resolve(location)
        } catch (_: Exception) {
            throw ApkDownloadException("invalid_redirect", "APK redirect location is invalid.")
        }
        return httpsUrl(resolved.toString())
    }

    private fun httpsUrl(value: String): URL {
        val uri = try {
            URI(value)
        } catch (_: Exception) {
            throw ApkDownloadException("invalid_url", "APK URL is invalid.")
        }
        if (
            !uri.scheme.equals("https", ignoreCase = true) ||
            uri.host.isNullOrBlank() ||
            uri.userInfo != null
        ) {
            throw ApkDownloadException("invalid_url", "Only HTTPS APK URLs are allowed.")
        }
        return try {
            uri.toURL()
        } catch (_: Exception) {
            throw ApkDownloadException("invalid_url", "APK URL is invalid.")
        }
    }

    private fun normalizeChecksum(value: String?): String? {
        if (value == null) return null
        val normalized = value.trim().lowercase(Locale.ROOT).removePrefix("sha256:")
        if (!SHA256_HEX.matches(normalized)) {
            throw ApkDownloadException("invalid_digest", "APK checksum is invalid.")
        }
        return normalized
    }

    private fun normalizeReleaseVersion(value: String?): String? {
        if (value == null) return null
        val normalized = value.trim()
        if (!RELEASE_VERSION.matches(normalized)) {
            throw ApkDownloadException("invalid_release", "APK release version is invalid.")
        }
        return normalized
    }

    private fun ensureSpace(directory: File, needed: Long?) {
        if (needed != null && needed > availableBytes(directory)) {
            throw ApkDownloadException("insufficient_storage", "There is not enough space for the APK.")
        }
    }

    private fun truncate(file: File) {
        try {
            FileOutputStream(file, false).use { output -> output.fd.sync() }
        } catch (error: IOException) {
            throw ApkDownloadException("write_failed", error.message ?: "Unable to reset the partial APK.")
        }
    }

    private fun openOutput(file: File, append: Boolean): FileOutputStream = try {
        FileOutputStream(file, append)
    } catch (error: IOException) {
        throw ApkDownloadException("write_failed", error.message ?: "Unable to write the APK.")
    }

    private fun safeValidator(value: String?): String? =
        value?.trim()?.takeIf { it.isNotEmpty() && it.length <= MAX_VALIDATOR_LENGTH }

    private fun resumeValidatorChanged(
        saved: ApkResumeMetadata,
        connection: HttpURLConnection,
    ): Boolean {
        val responseEtag = safeValidator(connection.getHeaderField("ETag"))
        val responseLastModified = safeValidator(connection.getHeaderField("Last-Modified"))
        return (saved.etag != null && saved.etag != responseEtag) ||
            (saved.lastModified != null && saved.lastModified != responseLastModified)
    }

    private fun throwIfStopped(control: ApkDownloadControl) {
        if (control.cancelled.get() || control.stopped.get()) {
            throw CancellationException("APK download stopped.")
        }
    }

    private fun MessageDigest.digestHex(): String = digest().joinToString("") { byte ->
        "%02x".format(Locale.ROOT, byte.toInt() and 0xff)
    }

    private data class ExistingPartial(val bytes: Long, val digest: MessageDigest)

    private data class ContentRange(val start: Long, val end: Long, val total: Long?)

    private companion object {
        const val BUFFER_BYTES = 64 * 1024
        const val CONNECT_TIMEOUT_MS = 30_000
        const val READ_TIMEOUT_MS = 30_000
        const val MAX_REDIRECTS = 5
        const val MAX_VALIDATOR_LENGTH = 512
        const val HTTP_RANGE_NOT_SATISFIABLE = 416
        val REDIRECT_STATUSES = setOf(301, 302, 303, 307, 308)
        val SHA256_HEX = Regex("[a-f0-9]{64}")
        val RELEASE_VERSION = Regex("[0-9]+\\.[0-9]+\\.[0-9]+")
        val CONTENT_RANGE = Regex("bytes\\s+(\\d+)-(\\d+)/(\\d+|\\*)", RegexOption.IGNORE_CASE)
    }
}

private data class ApkStoredTask(
    val id: String,
    val spec: ApkDownloadSpec,
    val state: ApkTaskState,
    val downloadedBytes: Long,
    val totalBytes: Long?,
    val errorCode: String?,
    val resumeMetadata: ApkResumeMetadata,
    val retryCount: Int,
)

private data class ApkStoredState(
    val tasks: List<ApkStoredTask>,
    val activeTaskId: String?,
    val readyTaskId: String?,
    val latestTaskId: String?,
)

/** A tiny app-private journal; the partial file remains the authoritative byte offset. */
private class ApkUpdateStateStore(private val directory: File) {
    private val stateFile = File(directory, "apk-task.properties")
    private val temporaryFile = File(directory, "apk-task.properties.tmp")

    fun load(): ApkStoredState? {
        if (!stateFile.isFile) return null
        val properties = Properties()
        try {
            FileInputStream(stateFile).use(properties::load)
            val ids = properties.getProperty("taskIds", "")
                .split(',')
                .filter(String::isNotBlank)
            val tasks = ids.map { id -> readTask(properties, id) }
            return ApkStoredState(
                tasks = tasks,
                activeTaskId = properties.getProperty("activeTaskId").blankToNull(),
                readyTaskId = properties.getProperty("readyTaskId").blankToNull(),
                latestTaskId = properties.getProperty("latestTaskId").blankToNull(),
            )
        } catch (error: Exception) {
            throw ApkDownloadException("state_read_failed", error.message ?: "Unable to read APK task state.")
        }
    }

    fun save(state: ApkStoredState) {
        val properties = Properties().apply {
            setProperty("taskIds", state.tasks.joinToString(",") { it.id })
            putNullable("activeTaskId", state.activeTaskId)
            putNullable("readyTaskId", state.readyTaskId)
            putNullable("latestTaskId", state.latestTaskId)
            state.tasks.forEach { task -> writeTask(task) }
        }
        try {
            FileOutputStream(temporaryFile, false).use { output ->
                properties.store(output, null)
                output.fd.sync()
            }
            if (!temporaryFile.renameTo(stateFile)) {
                throw IOException("Unable to replace APK task state.")
            }
        } catch (error: Exception) {
            throw ApkDownloadException("state_write_failed", error.message ?: "Unable to save APK task state.")
        }
    }

    private fun Properties.writeTask(task: ApkStoredTask) {
        val prefix = "task.${task.id}."
        setProperty("${prefix}url", task.spec.url)
        putNullable("${prefix}expectedSha256", task.spec.expectedSha256)
        putNullable("${prefix}expectedBytes", task.spec.expectedBytes?.toString())
        putNullable("${prefix}releaseVersion", task.spec.releaseVersion)
        setProperty("${prefix}state", task.state.wireValue())
        setProperty("${prefix}downloadedBytes", task.downloadedBytes.toString())
        putNullable("${prefix}totalBytes", task.totalBytes?.toString())
        putNullable("${prefix}errorCode", task.errorCode)
        putNullable("${prefix}etag", task.resumeMetadata.etag)
        putNullable("${prefix}lastModified", task.resumeMetadata.lastModified)
        setProperty("${prefix}retryCount", task.retryCount.toString())
    }

    private fun readTask(properties: Properties, id: String): ApkStoredTask {
        if (!TASK_ID.matches(id)) throw ApkDownloadException("state_read_failed", "APK task state is invalid.")
        val prefix = "task.$id."
        val url = properties.getProperty("${prefix}url")
            ?: throw ApkDownloadException("state_read_failed", "APK task URL is missing.")
        val state = properties.getProperty("${prefix}state")?.let(ApkTaskState::fromWireValue)
            ?: throw ApkDownloadException("state_read_failed", "APK task state is invalid.")
        val downloadedBytes = properties.getProperty("${prefix}downloadedBytes")?.toLongOrNull()
            ?.takeIf { it >= 0L }
            ?: throw ApkDownloadException("state_read_failed", "APK task byte count is invalid.")
        val expectedBytes = properties.getProperty("${prefix}expectedBytes").blankToNull()?.toLongOrNull()
            ?.takeIf { it > 0L }
        val totalBytes = properties.getProperty("${prefix}totalBytes").blankToNull()?.toLongOrNull()
            ?.takeIf { it > 0L }
        val retryCount = properties.getProperty("${prefix}retryCount", "0").toIntOrNull()
            ?.takeIf { it in 0..APK_MAX_RETRY_ATTEMPTS }
            ?: throw ApkDownloadException("state_read_failed", "APK retry count is invalid.")
        return ApkStoredTask(
            id = id,
            spec = ApkDownloadSpec(
                url = url,
                expectedSha256 = properties.getProperty("${prefix}expectedSha256").blankToNull(),
                expectedBytes = expectedBytes,
                releaseVersion = properties.getProperty("${prefix}releaseVersion").blankToNull(),
            ),
            state = state,
            downloadedBytes = downloadedBytes,
            totalBytes = totalBytes,
            errorCode = properties.getProperty("${prefix}errorCode").blankToNull(),
            resumeMetadata = ApkResumeMetadata(
                etag = properties.getProperty("${prefix}etag").blankToNull(),
                lastModified = properties.getProperty("${prefix}lastModified").blankToNull(),
            ),
            retryCount = retryCount,
        )
    }

    private fun Properties.putNullable(key: String, value: String?) {
        if (value == null) remove(key) else setProperty(key, value)
    }

    private fun String?.blankToNull(): String? = this?.takeIf(String::isNotBlank)

    private companion object {
        val TASK_ID = Regex("[0-9a-f-]{36}")
    }
}

/** Owns one persisted APK task; the foreground service or UIDT job owns the actual worker. */
internal class ApkUpdateManager(
    private val filesDirectory: File,
    private val downloader: ApkFileDownloader = ApkFileDownloader(),
) {
    private class Task(
        val id: String,
        val spec: ApkDownloadSpec,
        val partial: File,
        val target: File,
        var state: ApkTaskState,
        var downloadedBytes: Long,
        var totalBytes: Long?,
        var errorCode: String?,
        var resumeMetadata: ApkResumeMetadata,
        var retryCount: Int,
        var control: ApkDownloadControl = ApkDownloadControl(),
        var running: Boolean = false,
    )

    private val lock = Any()
    private val directory = updatesDirectory()
    private val stateStore = ApkUpdateStateStore(directory)
    private val tasks = linkedMapOf<String, Task>()
    private val listeners = CopyOnWriteArraySet<(ApkTaskSnapshot) -> Unit>()
    private var activeTaskId: String? = null
    private var readyTaskId: String? = null
    private var latestTaskId: String? = null
    private var lastProgressNotificationMs = 0L
    private var lastProgressPersistMs = 0L

    init {
        restoreState()
    }

    fun addListener(listener: (ApkTaskSnapshot) -> Unit): () -> Unit {
        listeners += listener
        return { listeners -= listener }
    }

    fun start(spec: ApkDownloadSpec): ApkTaskSnapshot {
        val normalized = downloader.validate(spec)
        val snapshot = synchronized(lock) {
            activeTaskId?.let { activeId ->
                val active = tasks[activeId]
                    ?: throw ApkDownloadException("task_active", "An APK download is already in progress.")
                if (sameArtifact(active.spec, normalized)) return@synchronized snapshot(active)
                throw ApkDownloadException("task_active", "An APK download is already in progress.")
            }
            readyTaskId
                ?.let(tasks::get)
                ?.takeIf {
                    it.state == ApkTaskState.READY &&
                        it.target.isFile &&
                        it.target.length() > 0L &&
                        sameArtifact(it.spec, normalized)
                }
                ?.let { return@synchronized snapshot(it) }
            reusableTask(normalized)?.let { task ->
                task.state = ApkTaskState.DOWNLOADING
                task.downloadedBytes = task.partial.length().coerceAtLeast(0L)
                task.totalBytes = normalized.expectedBytes ?: task.totalBytes
                task.errorCode = null
                task.retryCount = 0
                task.control = ApkDownloadControl()
                activeTaskId = task.id
                latestTaskId = task.id
                persistLocked()
                return@synchronized snapshot(task)
            }
            val id = UUID.randomUUID().toString()
            val task = Task(
                id = id,
                spec = normalized,
                partial = File(directory, "$id.apk.part"),
                target = File(directory, "$id.apk"),
                state = ApkTaskState.DOWNLOADING,
                downloadedBytes = 0L,
                totalBytes = normalized.expectedBytes,
                errorCode = null,
                resumeMetadata = ApkResumeMetadata(),
                retryCount = 0,
            )
            tasks[id] = task
            activeTaskId = id
            latestTaskId = id
            persistLocked()
            snapshot(task)
        }
        notify(snapshot, force = true)
        return snapshot
    }

    fun status(taskId: String): ApkTaskSnapshot = synchronized(lock) { snapshot(taskFor(taskId)) }

    fun statusOrNull(taskId: String): ApkTaskSnapshot? = synchronized(lock) {
        tasks[taskId]?.let(::snapshot)
    }

    fun latestStatus(spec: ApkDownloadSpec): ApkTaskSnapshot? {
        val normalized = downloader.validate(spec)
        return synchronized(lock) {
            val latest = latestTaskId?.let(tasks::get)
                ?.takeIf { sameArtifact(it.spec, normalized) }
            val ready = readyTaskId?.let(tasks::get)
                ?.takeIf { sameArtifact(it.spec, normalized) }
            when {
                latest == null -> ready?.let(::snapshot)
                latest.state == ApkTaskState.FAILED || latest.state == ApkTaskState.CANCELLED ->
                    ready?.let(::snapshot) ?: snapshot(latest)
                else -> snapshot(latest)
            }
        }
    }

    fun run(taskId: String): ApkRunResult {
        val task = synchronized(lock) {
            val candidate = taskFor(taskId)
            if (candidate.running) return ApkRunResult(ApkRunOutcome.SKIPPED)
            if (candidate.state == ApkTaskState.FAILED && candidate.errorCode in RESUMABLE_ERRORS) {
                candidate.state = ApkTaskState.DOWNLOADING
                candidate.errorCode = null
                candidate.retryCount = 0
                candidate.control = ApkDownloadControl()
            }
            if (candidate.state != ApkTaskState.DOWNLOADING && candidate.state != ApkTaskState.VERIFYING) {
                return ApkRunResult(
                    when (candidate.state) {
                        ApkTaskState.READY -> ApkRunOutcome.READY
                        ApkTaskState.CANCELLED -> ApkRunOutcome.CANCELLED
                        else -> ApkRunOutcome.SKIPPED
                    },
                )
            }
            candidate.running = true
            candidate.downloadedBytes = candidate.partial.length().coerceAtLeast(0L)
            activeTaskId = candidate.id
            persistLocked()
            candidate
        }
        try {
            val downloaded = downloader.download(
                spec = task.spec,
                partial = task.partial,
                target = task.target,
                resumeMetadata = task.resumeMetadata,
                control = task.control,
                onProgress = { downloadedBytes, totalBytes -> publishProgress(task, downloadedBytes, totalBytes) },
                onVerifying = { publishVerifying(task) },
                onResponseMetadata = { metadata -> publishResumeMetadata(task, metadata) },
            )
            return finishReady(task, downloaded)
        } catch (_: CancellationException) {
            return if (task.control.cancelled.get()) {
                finishCancelled(task)
            } else {
                finishInterrupted(task)
            }
        } catch (error: Exception) {
            return if (isRetryable(error) && task.retryCount < APK_MAX_RETRY_ATTEMPTS) {
                scheduleRetry(task)
            } else {
                finishFailed(task, errorCode(error), retainPartial = isRetryable(error))
            }
        } finally {
            synchronized(lock) { task.running = false }
        }
    }

    fun cancel(taskId: String): ApkTaskSnapshot {
        val snapshot = synchronized(lock) {
            val task = taskFor(taskId)
            if (task.state == ApkTaskState.DOWNLOADING || task.state == ApkTaskState.VERIFYING) {
                task.control.cancelled.set(true)
                task.state = ApkTaskState.CANCELLED
                task.errorCode = "cancelled"
                if (!task.running) removePartial(task)
                if (activeTaskId == task.id) activeTaskId = null
                persistLocked()
            }
            snapshot(task)
        }
        notify(snapshot, force = true)
        return snapshot
    }

    /** Stops a system-owned worker without treating it as a user cancellation. */
    fun pause(taskId: String): Boolean = synchronized(lock) {
        val task = tasks[taskId] ?: return false
        if (task.state != ApkTaskState.DOWNLOADING && task.state != ApkTaskState.VERIFYING) return false
        if (task.control.cancelled.get()) return false
        task.control.stopped.set(true)
        if (!task.running) {
            task.state = ApkTaskState.FAILED
            task.errorCode = "interrupted"
            if (activeTaskId == task.id) activeTaskId = null
            persistLocked()
            notify(snapshot(task), force = true)
        }
        true
    }

    fun markSchedulingFailed(taskId: String) {
        val snapshot = synchronized(lock) {
            val task = taskFor(taskId)
            task.state = ApkTaskState.FAILED
            task.errorCode = "scheduling_failed"
            if (activeTaskId == task.id) activeTaskId = null
            persistLocked()
            snapshot(task)
        }
        notify(snapshot, force = true)
    }

    fun installableFile(taskId: String): File = synchronized(lock) {
        val task = taskFor(taskId)
        if (task.state != ApkTaskState.READY || !task.target.isFile || task.target.length() == 0L) {
            throw ApkDownloadException("not_ready", "No verified APK is ready to install.")
        }
        task.target
    }

    private fun finishReady(task: Task, downloaded: ApkDownloadedFile): ApkRunResult {
        val snapshot: ApkTaskSnapshot
        val previousReady: Task?
        synchronized(lock) {
            if (task.control.cancelled.get()) return finishCancelled(task)
            if (task.control.stopped.get()) return finishInterrupted(task)
            task.state = ApkTaskState.READY
            task.downloadedBytes = downloaded.downloadedBytes
            task.totalBytes = downloaded.totalBytes
            task.resumeMetadata = downloaded.resumeMetadata
            task.errorCode = null
            task.retryCount = 0
            if (activeTaskId == task.id) activeTaskId = null
            previousReady = readyTaskId?.let(tasks::get)?.takeIf { it.id != task.id }
            readyTaskId = task.id
            latestTaskId = task.id
            persistLocked()
            snapshot = snapshot(task)
        }
        if (previousReady != null) {
            removeReadyTask(previousReady)
        }
        notify(snapshot, force = true)
        return ApkRunResult(ApkRunOutcome.READY)
    }

    private fun finishCancelled(task: Task): ApkRunResult {
        val snapshot = synchronized(lock) {
            task.state = ApkTaskState.CANCELLED
            task.errorCode = "cancelled"
            removePartial(task)
            removeTarget(task)
            if (activeTaskId == task.id) activeTaskId = null
            persistLocked()
            snapshot(task)
        }
        notify(snapshot, force = true)
        return ApkRunResult(ApkRunOutcome.CANCELLED)
    }

    private fun finishInterrupted(task: Task): ApkRunResult {
        val snapshot = synchronized(lock) {
            if (task.control.cancelled.get()) return finishCancelled(task)
            task.state = ApkTaskState.FAILED
            task.errorCode = "interrupted"
            removeTarget(task)
            if (activeTaskId == task.id) activeTaskId = null
            persistLocked()
            snapshot(task)
        }
        notify(snapshot, force = true)
        return ApkRunResult(ApkRunOutcome.RETRY, retryDelayMs(task.retryCount + 1))
    }

    private fun scheduleRetry(task: Task): ApkRunResult {
        val snapshot: ApkTaskSnapshot
        val delay: Long
        synchronized(lock) {
            if (task.control.cancelled.get()) return finishCancelled(task)
            if (task.control.stopped.get()) return finishInterrupted(task)
            task.state = ApkTaskState.DOWNLOADING
            task.errorCode = null
            task.retryCount += 1
            task.downloadedBytes = task.partial.length().coerceAtLeast(0L)
            task.control = ApkDownloadControl()
            delay = retryDelayMs(task.retryCount)
            persistLocked()
            snapshot = snapshot(task)
        }
        notify(snapshot, force = true)
        return ApkRunResult(ApkRunOutcome.RETRY, delay)
    }

    private fun finishFailed(task: Task, errorCode: String, retainPartial: Boolean): ApkRunResult {
        val snapshot = synchronized(lock) {
            if (task.control.cancelled.get()) return finishCancelled(task)
            if (task.control.stopped.get()) return finishInterrupted(task)
            task.state = ApkTaskState.FAILED
            task.errorCode = errorCode
            if (!retainPartial) removePartial(task)
            removeTarget(task)
            if (activeTaskId == task.id) activeTaskId = null
            persistLocked()
            snapshot(task)
        }
        notify(snapshot, force = true)
        return ApkRunResult(ApkRunOutcome.FAILED)
    }

    private fun removeReadyTask(task: Task) {
        synchronized(lock) {
            if (task.target.exists()) task.target.delete()
            tasks.remove(task.id)
            persistLocked()
        }
    }

    private fun publishProgress(task: Task, downloadedBytes: Long, totalBytes: Long?) {
        val snapshot = synchronized(lock) {
            task.downloadedBytes = downloadedBytes
            task.totalBytes = totalBytes
            val now = System.currentTimeMillis()
            if (now - lastProgressPersistMs >= PROGRESS_PERSIST_MS) {
                lastProgressPersistMs = now
                persistLocked()
            }
            snapshot(task)
        }
        notify(snapshot, force = false)
    }

    private fun publishVerifying(task: Task) {
        val snapshot = synchronized(lock) {
            if (!task.control.cancelled.get() && !task.control.stopped.get()) {
                task.state = ApkTaskState.VERIFYING
                persistLocked()
            }
            snapshot(task)
        }
        notify(snapshot, force = true)
    }

    private fun publishResumeMetadata(task: Task, metadata: ApkResumeMetadata) {
        synchronized(lock) {
            task.resumeMetadata = metadata
            persistLocked()
        }
    }

    private fun restoreState() {
        val stored = stateStore.load() ?: return
        val snapshots = mutableListOf<ApkTaskSnapshot>()
        synchronized(lock) {
            var stateChanged = false
            stored.tasks.forEach { saved ->
                val spec = downloader.validate(saved.spec)
                val task = Task(
                    id = saved.id,
                    spec = spec,
                    partial = File(directory, "${saved.id}.apk.part"),
                    target = File(directory, "${saved.id}.apk"),
                    state = saved.state,
                    downloadedBytes = saved.downloadedBytes,
                    totalBytes = saved.totalBytes,
                    errorCode = saved.errorCode,
                    resumeMetadata = saved.resumeMetadata,
                    retryCount = saved.retryCount,
                )
                if (
                    task.state == ApkTaskState.READY &&
                        (!task.target.isFile || task.target.length() == 0L)
                ) {
                    task.state = ApkTaskState.FAILED
                    task.errorCode = "missing_file"
                    stateChanged = true
                }
                if (task.state == ApkTaskState.DOWNLOADING || task.state == ApkTaskState.VERIFYING) {
                    task.state = ApkTaskState.FAILED
                    task.errorCode = "interrupted"
                    snapshots += snapshot(task)
                    stateChanged = true
                }
                if (task.state == ApkTaskState.CANCELLED) {
                    removePartial(task)
                    stateChanged = true
                }
                if (task.state != ApkTaskState.READY) removeTarget(task)
                tasks[task.id] = task
            }
            val restoredReadyTaskId = stored.readyTaskId?.takeIf {
                tasks[it]?.state == ApkTaskState.READY
            }
            val restoredLatestTaskId = stored.latestTaskId?.takeIf(tasks::containsKey)
            if (
                stateChanged ||
                    stored.activeTaskId != null ||
                    stored.readyTaskId != restoredReadyTaskId ||
                    stored.latestTaskId != restoredLatestTaskId
            ) {
                stateChanged = true
            }
            readyTaskId = restoredReadyTaskId
            latestTaskId = restoredLatestTaskId
            activeTaskId = null
            if (stateChanged) persistLocked()
        }
        snapshots.forEach { notify(it, force = true) }
    }

    private fun reusableTask(spec: ApkDownloadSpec): Task? = latestTaskId
        ?.let(tasks::get)
        ?.takeIf {
            it.state == ApkTaskState.FAILED &&
                it.errorCode in RESUMABLE_ERRORS &&
                it.partial.isFile &&
                sameArtifact(it.spec, spec)
        }

    private fun sameArtifact(left: ApkDownloadSpec, right: ApkDownloadSpec): Boolean =
        left.url == right.url &&
            left.expectedSha256 == right.expectedSha256 &&
            left.expectedBytes == right.expectedBytes &&
            left.releaseVersion == right.releaseVersion

    private fun isRetryable(error: Exception): Boolean = when (error) {
        !is ApkDownloadException -> true
        else ->
            error.code.startsWith("http_5") ||
                error.code in setOf("http_408", "http_429", "download_failed", "empty_response")
    }

    private fun errorCode(error: Exception): String =
        (error as? ApkDownloadException)?.code ?: "download_failed"

    private fun retryDelayMs(retryCount: Int): Long =
        RETRY_INITIAL_MS * (1L shl (retryCount - 1).coerceIn(0, 2))

    private fun removePartial(task: Task) {
        if (task.partial.exists() && !task.partial.delete()) {
            throw ApkDownloadException("write_failed", "Unable to remove the partial APK.")
        }
    }

    private fun removeTarget(task: Task) {
        if (task.target.exists() && !task.target.delete()) {
            throw ApkDownloadException("write_failed", "Unable to remove the unfinished APK file.")
        }
    }

    private fun taskFor(taskId: String): Task =
        tasks[taskId] ?: throw ApkDownloadException("task_not_found", "APK task was not found.")

    private fun snapshot(task: Task): ApkTaskSnapshot = ApkTaskSnapshot(
        taskId = task.id,
        state = task.state,
        downloadedBytes = task.downloadedBytes,
        totalBytes = task.totalBytes,
        errorCode = task.errorCode,
    )

    private fun persistLocked() {
        stateStore.save(
            ApkStoredState(
                tasks = tasks.values.map { task ->
                    ApkStoredTask(
                        id = task.id,
                        spec = task.spec,
                        state = task.state,
                        downloadedBytes = task.downloadedBytes,
                        totalBytes = task.totalBytes,
                        errorCode = task.errorCode,
                        resumeMetadata = task.resumeMetadata,
                        retryCount = task.retryCount,
                    )
                },
                activeTaskId = activeTaskId,
                readyTaskId = readyTaskId,
                latestTaskId = latestTaskId,
            ),
        )
    }

    private fun updatesDirectory(): File {
        val root = filesDirectory.canonicalFile
        val directory = File(root, "localmed/updates").canonicalFile
        if (!directory.path.startsWith("${root.path}${File.separator}")) {
            throw ApkDownloadException("invalid_destination", "APK directory escapes app-private storage.")
        }
        if (!directory.isDirectory && !directory.mkdirs()) {
            throw ApkDownloadException("write_failed", "Unable to create the APK directory.")
        }
        return directory
    }

    private fun notify(snapshot: ApkTaskSnapshot, force: Boolean) {
        if (!force && snapshot.state == ApkTaskState.DOWNLOADING) {
            val now = System.currentTimeMillis()
            synchronized(lock) {
                if (now - lastProgressNotificationMs < PROGRESS_NOTIFICATION_MS) return
                lastProgressNotificationMs = now
            }
        }
        listeners.forEach { it(snapshot) }
    }

    private companion object {
        const val RETRY_INITIAL_MS = 1_000L
        const val PROGRESS_NOTIFICATION_MS = 250L
        const val PROGRESS_PERSIST_MS = 250L
        val RESUMABLE_ERRORS = setOf("interrupted", "download_failed")
    }
}
