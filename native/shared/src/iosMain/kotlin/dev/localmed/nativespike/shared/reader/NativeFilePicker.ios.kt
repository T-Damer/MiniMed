package dev.localmed.nativespike.shared.reader

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier

/** iOS document picker and PDFKit pages are not wired yet; screens hide the action. */
actual val nativeFilePickerAvailable: Boolean = false

@Composable
actual fun rememberNativeFilePicker(onResult: (NativeFilePick) -> Unit): () -> Unit {
    val latest by rememberUpdatedState(onResult)
    return remember { { latest(NativeFilePick.Failed("Открытие файлов на iOS появится позже.")) } }
}

actual val nativePdfSupported: Boolean = false

@Composable
actual fun NativePdfPages(bytes: ByteArray, modifier: Modifier, contentPadding: PaddingValues, onPage: (page: Int, count: Int) -> Unit, onError: (message: String) -> Unit) {
    Box(modifier)
}
