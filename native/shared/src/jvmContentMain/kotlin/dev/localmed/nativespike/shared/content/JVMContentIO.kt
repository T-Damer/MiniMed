package dev.localmed.nativespike.shared.content

import dev.localmed.nativespike.shared.core.NativeContentIO
import dev.localmed.nativespike.shared.core.NativeContentVerificationException
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.zip.GZIPInputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/** Real Android/Desktop transport. The caller supplies app-private storage, never a source root. */
class JVMContentIO(privateRoot: String) : NativeContentIO {
    private val root = File(privateRoot).canonicalFile.also { require(it.isDirectory || it.mkdirs()) }
    private fun file(path: String): File {
        require(path.isNotBlank() && !path.startsWith('/') && path.split('/').none { it == ".." || it == "." }) { "Invalid private content path" }
        return File(root,path).canonicalFile.also { require(it.toPath().startsWith(root.toPath()) && it != root) { "Content path escapes private root" } }
    }
    override fun exists(path: String) = file(path).isFile
    override fun databasePath(path: String) = file(path).absolutePath
    override suspend fun readText(path: String): String = withContext(Dispatchers.IO) { file(path).readText() }
    override suspend fun writeTextAtomic(path: String, text: String) = withContext(Dispatchers.IO) {
        val target = file(path); target.parentFile!!.mkdirs()
        val partial = File(target.parentFile,"${target.name}.partial")
        try {
            partial.outputStream().use { it.write(text.toByteArray(Charsets.UTF_8)); it.fd.sync() }
            currentCoroutineContext().ensureActive()
            Files.move(partial.toPath(),target.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING)
            Unit
        } finally { if (partial.exists()) check(partial.delete()) { "Cannot clean state staging" } }
    }
    override suspend fun verify(path: String, sha256: String, sizeBytes: Long) = withContext(Dispatchers.IO) {
        val source = file(path); if (source.length() != sizeBytes) throw NativeContentVerificationException("Content size mismatch")
        val hash = MessageDigest.getInstance("SHA-256")
        source.inputStream().use { input ->
            val buffer = ByteArray(64*1024)
            while (true) { currentCoroutineContext().ensureActive(); val n=input.read(buffer); if (n<0) break; hash.update(buffer,0,n) }
        }
        val actual = "sha256:"+hash.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
        if (actual != sha256) throw NativeContentVerificationException("Content checksum mismatch")
    }
    override suspend fun download(url: String, path: String, maximumBytes: Long, progress: (Long) -> Unit) = withContext(Dispatchers.IO) {
        val address = URL(url); require(address.protocol == "https") { "Downloads require HTTPS" }
        val target=file(path); target.parentFile!!.mkdirs()
        var connection: HttpURLConnection? = null
        var next=address
        try {
            for (redirect in 0..5) {
                currentCoroutineContext().ensureActive()
                connection = next.openConnection() as HttpURLConnection
                // ponytail: blocking reads cancel at the next read boundary, with this 15s timeout ceiling.
                connection.connectTimeout=15000;connection.readTimeout=15000;connection.instanceFollowRedirects=false
                val code=connection.responseCode
                if (code in listOf(301,302,303,307,308)) {
                    require(redirect<5) { "Too many download redirects" }
                    val location=connection.getHeaderField("Location") ?: error("Missing download redirect")
                    next=URL(next,location); require(next.protocol=="https") { "Unsafe download redirect" }
                    connection.disconnect();connection=null
                    continue
                }
                require(code==200) { "Download HTTP $code" }
                val length=connection.contentLengthLong
                require(length<0 || length<=maximumBytes) { "Download exceeds declared size" }
                var count=0L
                connection.inputStream.use { input -> target.outputStream().use { output ->
                    val buffer=ByteArray(64*1024)
                    while(true) { currentCoroutineContext().ensureActive();val n=input.read(buffer);if(n<0)break;count+=n;require(count<=maximumBytes) { "Download exceeds declared size" };output.write(buffer,0,n);progress(count) }
                    output.fd.sync()
                } }
                currentCoroutineContext().ensureActive()
                return@withContext
            }
            error("Download did not complete")
        } finally { connection?.disconnect() }
    }
    override suspend fun decodeGzip(source: String, target: String, maximumBytes: Long) = withContext(Dispatchers.IO) {
        val outputFile=file(target);outputFile.parentFile!!.mkdirs();var count=0L
        GZIPInputStream(file(source).inputStream()).use { input -> outputFile.outputStream().use { output ->
            val buffer=ByteArray(64*1024)
            while(true) { currentCoroutineContext().ensureActive();val n=input.read(buffer);if(n<0)break;count+=n;require(count<=maximumBytes) { "Decoded content exceeds declared size" };output.write(buffer,0,n) }
            output.fd.sync()
        } }
    }
    override suspend fun moveAtomic(source: String, target: String) = withContext(Dispatchers.IO) {
        val destination=file(target);destination.parentFile!!.mkdirs();currentCoroutineContext().ensureActive()
        Files.move(file(source).toPath(),destination.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);Unit
    }
    override suspend fun delete(path: String) = withContext(Dispatchers.IO) { Files.deleteIfExists(file(path).toPath());Unit }
}
