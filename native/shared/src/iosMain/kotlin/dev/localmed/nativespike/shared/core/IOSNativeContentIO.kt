@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package dev.localmed.nativespike.shared.core

import kotlinx.cinterop.ByteVar
import kotlinx.cinterop.UByteVar
import kotlinx.cinterop.alloc
import kotlinx.cinterop.allocArray
import kotlinx.cinterop.convert
import kotlinx.cinterop.get
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import platform.CoreCrypto.CC_SHA256_CTX
import platform.CoreCrypto.CC_SHA256_Final
import platform.CoreCrypto.CC_SHA256_Init
import platform.CoreCrypto.CC_SHA256_Update
import platform.Foundation.NSError
import platform.Foundation.NSFileManager
import platform.Foundation.NSHTTPURLResponse
import platform.Foundation.NSLock
import platform.Foundation.NSString
import platform.Foundation.NSURL
import platform.Foundation.NSURLSession
import platform.Foundation.NSURLSessionConfiguration
import platform.Foundation.NSURLSessionDownloadDelegateProtocol
import platform.Foundation.NSURLSessionDownloadTask
import platform.Foundation.NSURLSessionTask
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.stringWithContentsOfFile
import platform.Foundation.writeToFile
import platform.darwin.NSObject
import platform.posix.fclose
import platform.posix.ferror
import platform.posix.fopen
import platform.posix.fread
import platform.posix.fwrite
import platform.posix.rename
import platform.zlib.Z_OK
import platform.zlib.gzclose
import platform.zlib.gzopen
import platform.zlib.gzread
import kotlin.coroutines.coroutineContext
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** NSURLSession streams into private files; verified packs never pass through a byte-array body. */
class IOSNativeContentIO(private val privateRoot: String) : NativeContentIO {
    private val files = NSFileManager.defaultManager

    init {
        require(privateRoot.startsWith('/'))
        directory(privateRoot)
    }

    private fun path(relative: String): String {
        require(relative.isNotBlank() && !relative.startsWith('/') && !relative.contains('\\'))
        require(relative.split('/').none { it.isEmpty() || it == "." || it == ".." })
        return "$privateRoot/$relative"
    }

    private fun directory(absolute: String) {
        check(files.createDirectoryAtPath(absolute, true, null, null)) {
            "Не удалось создать локальное хранилище"
        }
    }

    private fun destination(relative: String): String = path(relative).also {
        directory(it.substringBeforeLast('/'))
    }

    override fun exists(path: String): Boolean = files.fileExistsAtPath(this.path(path))

    override fun databasePath(path: String): String = this.path(path)

    override suspend fun readText(path: String): String = withContext(Dispatchers.Default) {
        NSString.stringWithContentsOfFile(this@IOSNativeContentIO.path(path), NSUTF8StringEncoding, null)
            ?: error("Не удалось прочитать локальное состояние")
    }

    override suspend fun writeTextAtomic(path: String, text: String) = withContext(Dispatchers.Default) {
        check((text as NSString).writeToFile(destination(path), true, NSUTF8StringEncoding, null)) {
            "Не удалось сохранить локальное состояние"
        }
    }

    override suspend fun verify(path: String, sha256: String, sizeBytes: Long) = withContext(Dispatchers.Default) {
        require(Regex("sha256:[a-f0-9]{64}").matches(sha256) && sizeBytes > 0)
        memScoped {
            val file = fopen(this@IOSNativeContentIO.path(path), "rb") ?: error("Файл базы отсутствует")
            try {
                val context = alloc<CC_SHA256_CTX>()
                val buffer = allocArray<ByteVar>(BUFFER_SIZE)
                check(CC_SHA256_Init(context.ptr) == 1)
                var total = 0L
                while (true) {
                    coroutineContext.ensureActive()
                    val count = fread(buffer, 1.convert(), BUFFER_SIZE.convert(), file).toInt()
                    if (count == 0) {
                        check(ferror(file) == 0) { "Ошибка чтения базы" }
                        break
                    }
                    total += count
                    if (total > sizeBytes) throw NativeContentVerificationException("Размер базы превышает объявленный")
                    check(CC_SHA256_Update(context.ptr, buffer, count.toUInt()) == 1)
                }
                if (total != sizeBytes) throw NativeContentVerificationException("Размер базы не совпадает с каталогом")
                val digest = allocArray<UByteVar>(32)
                check(CC_SHA256_Final(digest, context.ptr) == 1)
                val actual = (0 until 32).joinToString("") { digest[it].toInt().toString(16).padStart(2, '0') }
                if ("sha256:$actual" != sha256) throw NativeContentVerificationException("Контрольная сумма базы не совпадает с каталогом")
            } finally {
                check(fclose(file) == 0) { "Не удалось закрыть файл базы" }
            }
        }
    }

    override suspend fun download(url: String, path: String, maximumBytes: Long, progress: (Long) -> Unit) {
        require(url.startsWith("https://") && maximumBytes > 0)
        val address = NSURL.URLWithString(url) ?: error("Некорректный адрес пакета")
        val target = destination(path)
        suspendCancellableCoroutine<Unit> { continuation ->
            val lock = NSLock()
            var failure: Throwable? = null
            var moved = false
            val delegate = object : NSObject(), NSURLSessionDownloadDelegateProtocol {
                override fun URLSession(
                    session: NSURLSession,
                    downloadTask: NSURLSessionDownloadTask,
                    didWriteData: Long,
                    totalBytesWritten: Long,
                    totalBytesExpectedToWrite: Long,
                ) {
                    lock.lock()
                    try {
                        if (!continuation.isActive) return
                        if (totalBytesWritten > maximumBytes || totalBytesExpectedToWrite > maximumBytes) {
                            failure = IllegalStateException("Размер загрузки превышает объявленный")
                            downloadTask.cancel()
                        } else {
                            progress(totalBytesWritten)
                        }
                    } finally {
                        lock.unlock()
                    }
                }

                override fun URLSession(
                    session: NSURLSession,
                    downloadTask: NSURLSessionDownloadTask,
                    didFinishDownloadingToURL: NSURL,
                ) {
                    lock.lock()
                    try {
                        if (!continuation.isActive || failure != null) return
                        val response = downloadTask.response as? NSHTTPURLResponse
                        check(response?.statusCode == 200L && response.URL?.scheme == "https") {
                            "Сервер не предоставил пакет"
                        }
                        check(downloadTask.countOfBytesReceived <= maximumBytes) {
                            "Размер загрузки превышает объявленный"
                        }
                        val temporary = didFinishDownloadingToURL.path ?: error("Файл загрузки отсутствует")
                        check(rename(temporary, target) == 0) { "Не удалось сохранить загруженный пакет" }
                        moved = true
                    } catch (cause: Exception) {
                        failure = cause
                    } finally {
                        lock.unlock()
                    }
                }

                override fun URLSession(session: NSURLSession, task: NSURLSessionTask, didCompleteWithError: NSError?) {
                    lock.lock()
                    try {
                        if (continuation.isActive) {
                            val cause = failure ?: didCompleteWithError?.let {
                                IllegalStateException("Не удалось загрузить пакет: ${it.localizedDescription}")
                            } ?: if (!moved) IllegalStateException("Загрузка не завершена") else null
                            if (cause == null) continuation.resume(Unit) else continuation.resumeWithException(cause)
                        }
                    } finally {
                        lock.unlock()
                        session.finishTasksAndInvalidate()
                    }
                }
            }
            val configuration = NSURLSessionConfiguration.ephemeralSessionConfiguration
            configuration.timeoutIntervalForRequest = 60.0
            configuration.timeoutIntervalForResource = 900.0
            val session = NSURLSession.sessionWithConfiguration(configuration, delegate, null)
            val task = session.downloadTaskWithURL(address)
            continuation.invokeOnCancellation {
                // Cancellation waits for any current rename so installer cleanup cannot race it.
                lock.lock()
                try {
                    task.cancel()
                    session.invalidateAndCancel()
                } finally {
                    lock.unlock()
                }
            }
            task.resume()
        }
    }

    override suspend fun decodeGzip(source: String, target: String, maximumBytes: Long) = withContext(Dispatchers.Default) {
        require(maximumBytes > 0)
        memScoped {
            val input = gzopen(path(source), "rb") ?: error("Не удалось открыть архив базы")
            try {
                val output = fopen(destination(target), "wb") ?: error("Не удалось создать файл базы")
                try {
                    val buffer = allocArray<ByteVar>(BUFFER_SIZE)
                    var total = 0L
                    while (true) {
                        coroutineContext.ensureActive()
                        val count = gzread(input, buffer, BUFFER_SIZE.toUInt())
                        check(count >= 0) { "Архив базы повреждён" }
                        if (count == 0) break
                        total += count
                        check(total <= maximumBytes) { "Размер распакованной базы превышает объявленный" }
                        check(fwrite(buffer, 1.convert(), count.convert(), output).toInt() == count) {
                            "Не удалось записать базу"
                        }
                    }
                } finally {
                    check(fclose(output) == 0) { "Не удалось закрыть распакованную базу" }
                }
            } finally {
                check(gzclose(input) == Z_OK) { "Архив базы повреждён" }
            }
        }
    }

    override suspend fun moveAtomic(source: String, target: String) = withContext(Dispatchers.Default) {
        check(rename(path(source), destination(target)) == 0) { "Не удалось активировать проверенную базу" }
    }

    override suspend fun delete(path: String) = withContext(Dispatchers.Default) {
        val absolute = this@IOSNativeContentIO.path(path)
        if (files.fileExistsAtPath(absolute)) {
            check(files.removeItemAtPath(absolute, null)) { "Не удалось удалить временный файл" }
        }
    }

    private companion object {
        const val BUFFER_SIZE = 65_536
    }
}
