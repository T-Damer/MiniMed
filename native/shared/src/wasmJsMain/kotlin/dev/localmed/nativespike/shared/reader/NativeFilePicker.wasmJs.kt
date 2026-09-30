package dev.localmed.nativespike.shared.reader

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import kotlinx.browser.document
import org.khronos.webgl.ArrayBuffer
import org.khronos.webgl.Int8Array
import org.khronos.webgl.get
import org.w3c.dom.HTMLInputElement
import org.w3c.files.FileReader
import org.w3c.files.get

actual val nativeFilePickerAvailable: Boolean = true

@Composable
actual fun rememberNativeFilePicker(onResult: (NativeFilePick) -> Unit): () -> Unit {
    val latest by rememberUpdatedState(onResult)
    return remember {
        {
            val input = document.createElement("input") as HTMLInputElement
            input.type = "file"
            input.onchange = {
                val file = input.files?.get(0)
                if (file == null) {
                    latest(NativeFilePick.Cancelled)
                } else if (file.size.toDouble() > NATIVE_MAX_OPENED_FILE_BYTES.toDouble()) {
                    latest(NativeFilePick.Failed("Файл больше 256 МБ."))
                } else {
                    val reader = FileReader()
                    reader.onload = {
                        val buffer = reader.result as ArrayBuffer
                        val view = Int8Array(buffer)
                        val bytes = ByteArray(view.length) { view[it] }
                        latest(NativeFilePick.Picked(NativeOpenedFile(file.name, file.type.ifEmpty { null }, bytes)))
                    }
                    reader.onerror = { latest(NativeFilePick.Failed("Браузер не отдал файл.")) }
                    reader.readAsArrayBuffer(file)
                }
            }
            input.click()
        }
    }
}

/** The browser preview is a developer tool: PDF pages are drawn on Android only. */
actual val nativePdfSupported: Boolean = false

@Composable
actual fun NativePdfPages(bytes: ByteArray, modifier: Modifier, contentPadding: PaddingValues, onPage: (page: Int, count: Int) -> Unit, onError: (message: String) -> Unit) {
    Box(modifier)
}
