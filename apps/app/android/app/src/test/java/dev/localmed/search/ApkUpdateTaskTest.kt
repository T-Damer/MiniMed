package dev.localmed.search

import java.io.BufferedInputStream
import java.io.IOException
import java.io.InputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ApkUpdateTaskTest {
    private lateinit var server: TestServer
    private lateinit var filesDirectory: File

    @Before
    fun startServer() {
        server = TestServer()
        filesDirectory = File.createTempFile("minimed-apk-update", "").apply {
            check(delete())
            check(mkdirs())
        }
    }

    @After
    fun stopServer() {
        server.stop()
        filesDirectory.deleteRecursively()
    }

    @Test fun cancellationSurvivesAnInFlightReadFailure() {
        val dir = java.nio.file.Files.createTempDirectory("apk-cancel-review").toFile()
        try {
            lateinit var manager: ApkUpdateManager
            lateinit var id: String
            val stream = object : InputStream() {
                override fun read(): Int {
                    manager.cancel(id)
                    throw IOException("connection reset after cancellation")
                }
            }
            manager = ApkUpdateManager(dir, ApkFileDownloader({ object : HttpURLConnection(it) {
                override fun connect() {}
                override fun disconnect() {}
                override fun usingProxy() = false
                override fun getResponseCode() = 200
                override fun getContentLengthLong() = 100L
                override fun getInputStream() = stream
            } }))
            id = manager.start(ApkDownloadSpec("https://example.test/update.apk", null, 100L)).taskId
            val result = manager.run(id)
            assertEquals(ApkRunOutcome.CANCELLED, result.outcome)
            assertEquals(ApkTaskState.CANCELLED, manager.status(id).state)
        } finally { dir.deleteRecursively() }
    }

    @Test
    fun streamsAValidatedHttpsRedirectIntoThePrivateTarget() {
        val payload = ByteArray(256 * 1024 + 17) { index -> (index % 251).toByte() }
        server.respond("/payload", payload)
        server.redirect("/redirect", "https://download.example/payload")
        val requested = mutableListOf<URL>()
        val downloader = ApkFileDownloader(
            openConnection = { url ->
                requested += url
                localConnection(url)
            },
        )
        val partial = File(filesDirectory, "update.part")
        val target = File(filesDirectory, "update.apk")
        val progress = mutableListOf<Long>()

        val downloaded = downloader.download(
            spec = ApkDownloadSpec(
                url = "https://origin.example/redirect",
                expectedSha256 = "sha256:${sha256(payload)}",
                expectedBytes = payload.size.toLong(),
            ),
            partial = partial,
            target = target,
            resumeMetadata = ApkResumeMetadata(),
            control = ApkDownloadControl(),
            onProgress = { loaded, _ -> progress += loaded },
            onVerifying = {},
            onResponseMetadata = {},
        )

        assertEquals(payload.size.toLong(), downloaded.downloadedBytes)
        assertArrayEquals(payload, target.readBytes())
        assertFalse(partial.exists())
        assertTrue(progress.size > 2)
        assertEquals(listOf("https", "https"), requested.map { it.protocol })
    }

    @Test
    fun permitsUnknownLengthWithoutInventingAProgressTotal() {
        val payload = "APK bytes".toByteArray()
        server.respond("/chunked", payload, knownLength = false)
        val result = ApkFileDownloader(::localConnection).download(
            spec = ApkDownloadSpec("https://download.example/chunked", null, null),
            partial = File(filesDirectory, "update.part"),
            target = File(filesDirectory, "update.apk"),
            resumeMetadata = ApkResumeMetadata(),
            control = ApkDownloadControl(),
            onProgress = { _, _ -> },
            onVerifying = {},
            onResponseMetadata = {},
        )

        assertEquals(null, result.totalBytes)
    }

    @Test
    fun rejectsUnsafeRedirectsKnownSizeMismatchAndInsufficientStorage() {
        val payload = "APK bytes".toByteArray()
        server.redirect("/http-redirect", "http://download.example/payload")
        server.respond("/payload", payload)
        val downloader = ApkFileDownloader(::localConnection)

        expectCode("invalid_url") {
            downloader.download(
                ApkDownloadSpec("https://download.example/http-redirect", null, null),
                File(filesDirectory, "redirect.part"),
                File(filesDirectory, "redirect.apk"),
                ApkResumeMetadata(),
                ApkDownloadControl(),
                { _, _ -> },
                {},
                {},
            )
        }
        expectCode("size_mismatch") {
            downloader.download(
                ApkDownloadSpec("https://download.example/payload", null, payload.size.toLong() + 1),
                File(filesDirectory, "size.part"),
                File(filesDirectory, "size.apk"),
                ApkResumeMetadata(),
                ApkDownloadControl(),
                { _, _ -> },
                {},
                {},
            )
        }
        expectCode("insufficient_storage") {
            ApkFileDownloader(::localConnection) { 0L }.download(
                ApkDownloadSpec("https://download.example/payload", null, payload.size.toLong()),
                File(filesDirectory, "space.part"),
                File(filesDirectory, "space.apk"),
                ApkResumeMetadata(),
                ApkDownloadControl(),
                { _, _ -> },
                {},
                {},
            )
        }
        expectCode("invalid_release") {
            downloader.validate(
                ApkDownloadSpec(
                    "https://download.example/payload",
                    null,
                    null,
                    releaseVersion = "not-a-release",
                ),
            )
        }
    }

    @Test
    fun preservesThePreviousReadyApkWhenTheNextDownloadFails() {
        val payload = "APK bytes".toByteArray()
        server.respond("/payload", payload)
        val manager = ApkUpdateManager(filesDirectory, ApkFileDownloader(::localConnection))
        val first = manager.start(
            ApkDownloadSpec("https://download.example/payload", "sha256:${sha256(payload)}", payload.size.toLong()),
        )
        assertEquals(ApkRunOutcome.READY, manager.run(first.taskId).outcome)
        val original = manager.installableFile(first.taskId).readBytes()

        val second = manager.start(
            ApkDownloadSpec("https://download.example/payload", "sha256:${"0".repeat(64)}", payload.size.toLong()),
        )
        assertEquals(ApkRunOutcome.FAILED, manager.run(second.taskId).outcome)
        assertEquals(ApkTaskState.READY, manager.status(first.taskId).state)
        assertArrayEquals(original, manager.installableFile(first.taskId).readBytes())
        assertEquals(first.taskId, manager.latestStatus(firstSpec(payload))?.taskId)
    }

    @Test
    fun rejectsCompetingTasksAndFinalizesCancellation() {
        val manager = ApkUpdateManager(filesDirectory, ApkFileDownloader(::localConnection))
        val first = manager.start(ApkDownloadSpec("https://download.example/payload", null, null))
        expectCode("task_active") {
            manager.start(ApkDownloadSpec("https://download.example/other.apk", null, null))
        }
        File(filesDirectory, "localmed/updates/${first.taskId}.apk.part").writeBytes("partial".toByteArray())
        assertEquals(ApkTaskState.CANCELLED, manager.cancel(first.taskId).state)
        assertFalse(File(filesDirectory, "localmed/updates/${first.taskId}.apk.part").exists())
    }

    @Test
    fun retriesTransientServerFailuresButNotMissingAssets() {
        server.respond("/missing", ByteArray(0), status = 404)
        server.respond("/unavailable", ByteArray(0), status = 500)
        val manager = ApkUpdateManager(filesDirectory, ApkFileDownloader(::localConnection))

        val missing = manager.start(ApkDownloadSpec("https://download.example/missing", null, null))
        assertEquals(ApkRunOutcome.FAILED, manager.run(missing.taskId).outcome)
        assertEquals("http_404", manager.status(missing.taskId).errorCode)

        val unavailable = manager.start(ApkDownloadSpec("https://download.example/unavailable", null, null))
        assertEquals(ApkRunOutcome.RETRY, manager.run(unavailable.taskId).outcome)
        assertEquals(ApkRunOutcome.RETRY, manager.run(unavailable.taskId).outcome)
        assertEquals(ApkRunOutcome.RETRY, manager.run(unavailable.taskId).outcome)
        assertEquals(ApkRunOutcome.FAILED, manager.run(unavailable.taskId).outcome)
        assertEquals("http_500", manager.status(unavailable.taskId).errorCode)
    }

    @Test
    fun restoresAnInterruptedTaskAndResumesFromTheActualPartialFile() {
        val payload = ByteArray(512 * 1024) { index -> (index % 233).toByte() }
        val prefixSize = 160 * 1024
        server.respondSequence(
            "/resume",
            TestServer.Response(
                status = 206,
                body = payload.copyOfRange(prefixSize, payload.size),
                headers = mapOf(
                    "Content-Range" to "bytes $prefixSize-${payload.size - 1}/${payload.size}",
                    "ETag" to "\"asset-v1\"",
                ),
            ),
            TestServer.Response(status = 200, body = payload, headers = mapOf("ETag" to "\"asset-v1\"")),
        )
        val spec = ApkDownloadSpec(
            "https://download.example/resume",
            "sha256:${sha256(payload)}",
            payload.size.toLong(),
        )
        val firstManager = ApkUpdateManager(filesDirectory, ApkFileDownloader(::localConnection))
        val task = firstManager.start(spec)
        val partial = File(filesDirectory, "localmed/updates/${task.taskId}.apk.part")
        partial.writeBytes(payload.copyOfRange(0, prefixSize))

        val restoredManager = ApkUpdateManager(filesDirectory, ApkFileDownloader(::localConnection))
        assertEquals(ApkTaskState.FAILED, restoredManager.status(task.taskId).state)
        assertEquals("interrupted", restoredManager.status(task.taskId).errorCode)

        val resumed = restoredManager.start(spec)
        assertEquals(task.taskId, resumed.taskId)
        assertEquals(ApkRunOutcome.READY, restoredManager.run(resumed.taskId).outcome)
        assertArrayEquals(payload, restoredManager.installableFile(resumed.taskId).readBytes())
        assertEquals(listOf("bytes=$prefixSize-", null), server.headers("/resume", "range"))
    }

    @Test
    fun restartsWhenTheServerIgnoresRangeForAChangedArtifact() {
        val previous = "old APK".toByteArray()
        val replacement = "new APK bytes".toByteArray()
        server.respond("/changed", replacement, headers = mapOf("ETag" to "\"asset-v2\""))
        val partial = File(filesDirectory, "changed.part").apply { writeBytes(previous) }
        val target = File(filesDirectory, "changed.apk")

        ApkFileDownloader(::localConnection).download(
            spec = ApkDownloadSpec(
                "https://download.example/changed",
                "sha256:${sha256(replacement)}",
                replacement.size.toLong(),
            ),
            partial = partial,
            target = target,
            resumeMetadata = ApkResumeMetadata(etag = "\"asset-v1\""),
            control = ApkDownloadControl(),
            onProgress = { _, _ -> },
            onVerifying = {},
            onResponseMetadata = {},
        )

        assertEquals("bytes=${previous.size}-", server.lastHeader("/changed", "range"))
        assertEquals("\"asset-v1\"", server.lastHeader("/changed", "if-range"))
        assertArrayEquals(replacement, target.readBytes())
    }

    @Test
    fun restartsFromZeroWhenTheResumeValidatorChanges() {
        val payload = ByteArray(128 * 1024) { index -> (index % 227).toByte() }
        val prefixSize = 48 * 1024
        server.respondSequence(
            "/validator-changed",
            TestServer.Response(
                status = 206,
                body = payload.copyOfRange(prefixSize, payload.size),
                headers = mapOf(
                    "Content-Range" to "bytes $prefixSize-${payload.size - 1}/${payload.size}",
                    "ETag" to "\"asset-v2\"",
                ),
            ),
            TestServer.Response(
                status = 200,
                body = payload,
                headers = mapOf("ETag" to "\"asset-v2\""),
            ),
        )
        val partial = File(filesDirectory, "validator.part").apply {
            writeBytes(payload.copyOfRange(0, prefixSize))
        }
        val target = File(filesDirectory, "validator.apk")

        ApkFileDownloader(::localConnection).download(
            spec = ApkDownloadSpec(
                "https://download.example/validator-changed",
                "sha256:${sha256(payload)}",
                payload.size.toLong(),
            ),
            partial = partial,
            target = target,
            resumeMetadata = ApkResumeMetadata(etag = "\"asset-v1\""),
            control = ApkDownloadControl(),
            onProgress = { _, _ -> },
            onVerifying = {},
            onResponseMetadata = {},
        )

        assertEquals(
            listOf("bytes=$prefixSize-", null),
            server.headers("/validator-changed", "range"),
        )
        assertArrayEquals(payload, target.readBytes())
    }

    @Test
    fun restartsFromZeroWhenAResumeValidatorCannotBeConfirmed() {
        val payload = ByteArray(128 * 1024) { index -> (index % 227).toByte() }
        val prefixSize = 48 * 1024
        server.respondSequence(
            "/validator-missing",
            TestServer.Response(
                status = 206,
                body = payload.copyOfRange(prefixSize, payload.size),
                headers = mapOf(
                    "Content-Range" to "bytes $prefixSize-${payload.size - 1}/${payload.size}",
                ),
            ),
            TestServer.Response(status = 200, body = payload),
        )
        val partial = File(filesDirectory, "validator-missing.part").apply {
            writeBytes(payload.copyOfRange(0, prefixSize))
        }
        val target = File(filesDirectory, "validator-missing.apk")

        ApkFileDownloader(::localConnection).download(
            spec = ApkDownloadSpec(
                "https://download.example/validator-missing",
                "sha256:${sha256(payload)}",
                payload.size.toLong(),
            ),
            partial = partial,
            target = target,
            resumeMetadata = ApkResumeMetadata(etag = "\"asset-v1\""),
            control = ApkDownloadControl(),
            onProgress = { _, _ -> },
            onVerifying = {},
            onResponseMetadata = {},
        )

        assertEquals(
            listOf("bytes=$prefixSize-", null),
            server.headers("/validator-missing", "range"),
        )
        assertArrayEquals(payload, target.readBytes())
    }

    @Test
    fun keepsTheReadyTaskForTheSameArtifactAndPersistsItsMissingFileFailure() {
        val payload = "APK bytes".toByteArray()
        server.respond("/payload", payload)
        val firstManager = ApkUpdateManager(filesDirectory, ApkFileDownloader(::localConnection))
        val ready = firstManager.start(firstSpec(payload))
        assertEquals(ApkRunOutcome.READY, firstManager.run(ready.taskId).outcome)
        assertEquals(ready.taskId, firstManager.start(firstSpec(payload)).taskId)

        assertTrue(firstManager.installableFile(ready.taskId).delete())
        val restored = ApkUpdateManager(filesDirectory, ApkFileDownloader(::localConnection))
        assertEquals("missing_file", restored.status(ready.taskId).errorCode)
        val restoredAgain = ApkUpdateManager(filesDirectory, ApkFileDownloader(::localConnection))
        assertEquals("missing_file", restoredAgain.status(ready.taskId).errorCode)
    }

    @Test
    fun treatsTheReleaseVersionAsPartOfTheArtifactIdentity() {
        val payload = "APK bytes".toByteArray()
        server.respond("/rolling.apk", payload)
        val manager = ApkUpdateManager(filesDirectory, ApkFileDownloader(::localConnection))
        val firstSpec = ApkDownloadSpec(
            "https://download.example/rolling.apk",
            "sha256:${sha256(payload)}",
            payload.size.toLong(),
            releaseVersion = "1.0.0",
        )
        val ready = manager.start(firstSpec)
        assertEquals(ApkRunOutcome.READY, manager.run(ready.taskId).outcome)

        val next = manager.start(firstSpec.copy(releaseVersion = "1.0.1"))

        assertNotEquals(ready.taskId, next.taskId)
        assertEquals(ApkTaskState.READY, manager.status(ready.taskId).state)
        assertEquals(ApkTaskState.DOWNLOADING, next.state)
    }

    @Test
    fun acceptsA416OnlyAfterVerifyingTheCompletePartialFile() {
        val payload = "complete APK".toByteArray()
        server.respond("/already-complete", ByteArray(0), status = 416)
        val partial = File(filesDirectory, "complete.part").apply { writeBytes(payload) }
        val target = File(filesDirectory, "complete.apk")

        ApkFileDownloader(::localConnection).download(
            spec = ApkDownloadSpec(
                "https://download.example/already-complete",
                "sha256:${sha256(payload)}",
                payload.size.toLong(),
            ),
            partial = partial,
            target = target,
            resumeMetadata = ApkResumeMetadata(),
            control = ApkDownloadControl(),
            onProgress = { _, _ -> },
            onVerifying = {},
            onResponseMetadata = {},
        )

        assertArrayEquals(payload, target.readBytes())
    }

    @Test
    fun doesNotTreatA416AsReadyWithoutAPublishedDigest() {
        val payload = "complete APK".toByteArray()
        server.respond("/unverified-416", ByteArray(0), status = 416)
        val partial = File(filesDirectory, "unverified.part").apply { writeBytes(payload) }

        expectCode("invalid_range") {
            ApkFileDownloader(::localConnection).download(
                spec = ApkDownloadSpec(
                    "https://download.example/unverified-416",
                    null,
                    payload.size.toLong(),
                ),
                partial = partial,
                target = File(filesDirectory, "unverified.apk"),
                resumeMetadata = ApkResumeMetadata(),
                control = ApkDownloadControl(),
                onProgress = { _, _ -> },
                onVerifying = {},
                onResponseMetadata = {},
            )
        }
    }

    private fun localConnection(url: URL): HttpURLConnection =
        URL("http://127.0.0.1:${server.port}${url.file}").openConnection() as HttpURLConnection

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

    private fun firstSpec(payload: ByteArray): ApkDownloadSpec = ApkDownloadSpec(
        "https://download.example/payload",
        "sha256:${sha256(payload)}",
        payload.size.toLong(),
    )

    private fun expectCode(code: String, block: () -> Unit) {
        try {
            block()
        } catch (error: ApkDownloadException) {
            assertEquals(code, error.code)
            return
        }
        throw AssertionError("Expected APK error $code")
    }

    private class TestServer {
        data class Response(
            val status: Int,
            val body: ByteArray = ByteArray(0),
            val knownLength: Boolean = true,
            val headers: Map<String, String> = emptyMap(),
        )

        private val socket = ServerSocket(0)
        private val responses = ConcurrentHashMap<String, List<Response>>()
        private val responseIndexes = ConcurrentHashMap<String, AtomicInteger>()
        private val requests = ConcurrentHashMap<String, MutableList<Map<String, String>>>()
        private val thread = Thread(::serve, "minimed-apk-test-server").apply {
            isDaemon = true
            start()
        }

        val port: Int get() = socket.localPort

        fun respond(
            path: String,
            body: ByteArray,
            knownLength: Boolean = true,
            status: Int = 200,
            headers: Map<String, String> = emptyMap(),
        ) {
            respondSequence(path, Response(status, body, knownLength, headers))
        }

        fun redirect(path: String, location: String) {
            respond(path, ByteArray(0), status = 302, headers = mapOf("Location" to location))
        }

        fun respondSequence(path: String, vararg sequence: Response) {
            responses[path] = sequence.toList()
            responseIndexes.remove(path)
        }

        fun respondRange(path: String, start: Long, total: Long, body: ByteArray, etag: String) {
            respond(
                path,
                body,
                status = 206,
                headers = mapOf(
                    "Content-Range" to "bytes $start-${total - 1}/$total",
                    "ETag" to etag,
                ),
            )
        }

        fun lastHeader(path: String, name: String): String? =
            requests[path]?.lastOrNull()?.get(name.lowercase())

        fun headers(path: String, name: String): List<String?> =
            requests[path]?.map { it[name.lowercase()] } ?: emptyList()

        fun stop() {
            socket.close()
            thread.join(1_000)
        }

        private fun serve() {
            while (!socket.isClosed) {
                try {
                    val client = socket.accept()
                    Thread({ respondTo(client) }, "minimed-apk-test-client").apply {
                        isDaemon = true
                        start()
                    }
                } catch (_: Exception) {
                    if (!socket.isClosed) throw AssertionError("Test server failed.")
                }
            }
        }

        private fun respondTo(client: Socket) {
            client.use { socket ->
                val input = BufferedInputStream(socket.getInputStream())
                val request = readLine(input) ?: return
                val headers = mutableMapOf<String, String>()
                while (true) {
                    val line = readLine(input) ?: break
                    if (line.isEmpty()) break
                    val separator = line.indexOf(':')
                    if (separator > 0) {
                        headers[line.substring(0, separator).lowercase()] = line.substring(separator + 1).trim()
                    }
                }
                val path = request.split(' ').getOrNull(1)?.substringBefore('?') ?: return
                requests.computeIfAbsent(path) { Collections.synchronizedList(mutableListOf()) }.add(headers)
                val response = responses[path]?.let { sequence ->
                    val index = responseIndexes.computeIfAbsent(path) { AtomicInteger() }.getAndIncrement()
                    sequence[index.coerceAtMost(sequence.lastIndex)]
                } ?: Response(404)
                val output = socket.getOutputStream().buffered()
                output.write("HTTP/1.1 ${response.status} Test\r\nConnection: close\r\n".toByteArray(StandardCharsets.US_ASCII))
                response.headers.forEach { (name, value) ->
                    output.write("$name: $value\r\n".toByteArray(StandardCharsets.US_ASCII))
                }
                if (response.knownLength) {
                    output.write("Content-Length: ${response.body.size}\r\n\r\n".toByteArray(StandardCharsets.US_ASCII))
                    output.write(response.body)
                } else {
                    output.write("Transfer-Encoding: chunked\r\n\r\n".toByteArray(StandardCharsets.US_ASCII))
                    output.write("${response.body.size.toString(16)}\r\n".toByteArray(StandardCharsets.US_ASCII))
                    output.write(response.body)
                    output.write("\r\n0\r\n\r\n".toByteArray(StandardCharsets.US_ASCII))
                }
                output.flush()
            }
        }

        private fun readLine(input: BufferedInputStream): String? {
            val bytes = ArrayList<Byte>()
            while (true) {
                val value = input.read()
                if (value < 0) {
                    return if (bytes.isEmpty()) null else bytes.toByteArray().toString(StandardCharsets.US_ASCII)
                }
                if (value == '\n'.code) return bytes.toByteArray().toString(StandardCharsets.US_ASCII).trimEnd('\r')
                bytes += value.toByte()
            }
        }
    }
}
