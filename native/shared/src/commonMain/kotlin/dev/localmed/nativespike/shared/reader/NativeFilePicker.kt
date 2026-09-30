package dev.localmed.nativespike.shared.reader

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/** The outcome of asking the system for a file. */
sealed interface NativeFilePick {
    class Picked(val file: NativeOpenedFile) : NativeFilePick
    data object Cancelled : NativeFilePick
    data class Failed(val message: String) : NativeFilePick
}

/** Whether this platform can offer the system file picker. */
expect val nativeFilePickerAvailable: Boolean

/** Files above this size are refused before reading them into memory. */
const val NATIVE_MAX_OPENED_FILE_BYTES: Long = 256L * 1024 * 1024

/**
 * A launcher for the system «open file» dialog. The picked file is read off the main thread and
 * handed to [onResult] with its name and reported type; nothing is copied or kept.
 */
@Composable
expect fun rememberNativeFilePicker(onResult: (NativeFilePick) -> Unit): () -> Unit

/** Whether this platform draws PDF pages (Android `PdfRenderer`; others show a notice for now). */
expect val nativePdfSupported: Boolean

/**
 * PDF pages drawn by the platform, lazily, as a vertical list that fills the width. [onPage]
 * reports the page at the top of the view (0-based) and the page count; [onError] a file the
 * platform cannot open (damaged, encrypted).
 */
@Composable
expect fun NativePdfPages(
    bytes: ByteArray,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(),
    onPage: (page: Int, count: Int) -> Unit = { _, _ -> },
    onError: (message: String) -> Unit = {},
)
