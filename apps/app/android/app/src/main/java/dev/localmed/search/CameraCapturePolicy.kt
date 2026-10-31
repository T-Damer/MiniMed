package dev.localmed.search

import java.io.File

/** Plain-JVM rules of the native camera plugin: which files it may touch and when one is stale. */
internal object CameraCapturePolicy {
    const val DIRECTORY = "localmed/camera"

    /** A photo nobody took within a day (the app was closed with it pending) is removed. */
    const val STALE_AFTER_MS = 24L * 60 * 60 * 1000

    private val ID_PATTERN = Regex("^[A-Za-z0-9-]{8,64}$")

    /** Ids come from the page; only a plain token may become part of a file name. */
    fun isValidId(id: String?): Boolean = id != null && ID_PATTERN.matches(id)

    fun fileName(id: String): String = "$id.jpg"

    fun photoFile(cacheDir: File, id: String): File = File(File(cacheDir, DIRECTORY), fileName(id))

    fun isStale(lastModifiedMs: Long, nowMs: Long): Boolean = nowMs - lastModifiedMs > STALE_AFTER_MS

    /** `ecg` and `skin` route the photo after an app restart; anything else has no destination. */
    fun normalizePurpose(value: String?): String? =
        when (value) {
            "ecg", "skin" -> value
            else -> null
        }
}
