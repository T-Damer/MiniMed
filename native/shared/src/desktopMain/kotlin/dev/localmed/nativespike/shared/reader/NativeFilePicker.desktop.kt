package dev.localmed.nativespike.shared.reader

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.FileDialog
import java.awt.Frame
import java.io.File

actual val nativeFilePickerAvailable: Boolean = true

@Composable
actual fun rememberNativeFilePicker(onResult: (NativeFilePick) -> Unit): () -> Unit {
    val scope = rememberCoroutineScope()
    val latest by rememberUpdatedState(onResult)
    return remember {
        {
            // A modal AWT dialog on the UI thread; reading happens off it.
            val dialog = FileDialog(null as Frame?, "Открыть файл", FileDialog.LOAD).apply { isVisible = true }
            val name = dialog.file
            val directory = dialog.directory
            if (name == null || directory == null) {
                latest(NativeFilePick.Cancelled)
            } else {
                scope.launch {
                    val result = try {
                        val file = File(directory, name)
                        if (file.length() > NATIVE_MAX_OPENED_FILE_BYTES) throw IllegalStateException("Файл больше 256 МБ.")
                        NativeFilePick.Picked(NativeOpenedFile(name, null, withContext(Dispatchers.IO) { file.readBytes() }))
                    } catch (cause: CancellationException) {
                        throw cause
                    } catch (cause: Exception) {
                        NativeFilePick.Failed(cause.message ?: "Не удалось прочитать файл.")
                    }
                    latest(result)
                }
            }
        }
    }
}

/** Desktop is a developer target: PDF pages are drawn on Android only (docs/NATIVE_READER.md). */
actual val nativePdfSupported: Boolean = false

@Composable
actual fun NativePdfPages(bytes: ByteArray, modifier: Modifier, contentPadding: PaddingValues, onPage: (page: Int, count: Int) -> Unit, onError: (message: String) -> Unit) {
    Box(modifier)
}
