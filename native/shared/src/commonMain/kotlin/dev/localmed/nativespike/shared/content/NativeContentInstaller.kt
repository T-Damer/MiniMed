package dev.localmed.nativespike.shared.content

import dev.localmed.nativespike.shared.core.NativeContentIO
import dev.localmed.nativespike.shared.core.NativeContentVerificationException
import dev.localmed.nativespike.shared.core.NativeInstallProgress
import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

internal class NativeContentInstaller(private val io: NativeContentIO) {
    /** Validation completes before content-addressed activation. No live DB gate is held for I/O. */
    suspend fun prepare(artifact: NativeArtifact, token: Long, progress: (NativeInstallProgress) -> Unit, validate: suspend (NativeSearchDatabase) -> Unit): String = withContext(Dispatchers.Default) {
        require(checksumPattern.matches(artifact.sha256) && checksumPattern.matches(artifact.decodedSha256))
        require(artifact.sizeBytes>0 && artifact.decodedSizeBytes>0 && artifact.compression in setOf("none","gzip"))
        val destination="content/${artifact.decodedSha256.removePrefix("sha256:")}.db"
        val archive="staging/$token-${artifact.sha256.removePrefix("sha256:")}.download"
        val decoded="staging/$token-${artifact.decodedSha256.removePrefix("sha256:")}.db"
        try {
            if (io.exists(destination)) {
                try {
                    io.verify(destination,artifact.decodedSha256,artifact.decodedSizeBytes)
                    validateFile(destination,validate)
                    return@withContext destination
                } catch (cause: CancellationException) { throw cause } catch (cause: NativeContentVerificationException) {
                    // A generated cache with the wrong encoded identity cannot be mounted.
                    io.delete(destination)
                }
            }
            progress(NativeInstallProgress("download",0,artifact.sizeBytes))
            io.download(artifact.url,archive,artifact.sizeBytes) { progress(NativeInstallProgress("download",it,artifact.sizeBytes)) }
            io.verify(archive,artifact.sha256,artifact.sizeBytes)
            val source=if(artifact.compression=="gzip") {
                progress(NativeInstallProgress("decode",0,artifact.decodedSizeBytes));io.decodeGzip(archive,decoded,artifact.decodedSizeBytes);decoded
            } else archive
            io.verify(source,artifact.decodedSha256,artifact.decodedSizeBytes)
            progress(NativeInstallProgress("validate"))
            validateFile(source,validate)
            currentCoroutineContext().ensureActive()
            io.moveAtomic(source,destination)
            destination
        } finally {
            withContext(NonCancellable) { io.delete(archive);io.delete(decoded) }
        }
    }
    private suspend fun validateFile(path: String, validate: suspend (NativeSearchDatabase) -> Unit) {
        val database=NativeSearchDatabase(io.databasePath(path))
        try { database.open();validate(database) } finally { database.close() }
    }
}
