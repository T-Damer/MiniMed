package dev.localmed.nativespike.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import dev.localmed.nativespike.shared.platform.requestHighestRefreshRate
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import dev.localmed.nativespike.shared.designsystem.NativeDesign
import dev.localmed.nativespike.shared.designsystem.gallery.NativeReaderGallery
import dev.localmed.nativespike.shared.reader.NativeFileImport
import dev.localmed.nativespike.shared.reader.NativeReaderContent
import dev.localmed.nativespike.shared.reader.readDocument
import dev.localmed.nativespike.shared.ui.NativeSpikeTheme
import androidx.compose.foundation.background
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Debug-only reader lab: the design-system reader with «open file», and the target of «open with»
 * for PDF, Markdown, HTML and text, so the reader engine can be tried on a device before the app
 * screens adopt it.
 */
class ReaderLabActivity : ComponentActivity() {
    override fun onResume() {
        super.onResume()
        // 120 Hz on high-refresh phones (HyperOS needs an explicit display mode).
        requestHighestRefreshRate()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val uri = intent?.data
        setContent {
            NativeSpikeTheme {
                val initial by produceState<NativeReaderContent?>(null, uri) {
                    if (uri != null) {
                        value = try {
                            NativeFileImport.open(withContext(Dispatchers.IO) { readDocument(this@ReaderLabActivity, uri) })
                        } catch (cause: CancellationException) {
                            throw cause
                        } catch (cause: Exception) {
                            NativeReaderContent.Unsupported("Файл не открыт", cause.message ?: "Не удалось прочитать файл.")
                        }
                    }
                }
                Box(Modifier.fillMaxSize().background(NativeDesign.components.readerPaper.background).windowInsetsPadding(WindowInsets.safeDrawing)) {
                    if (uri == null || initial != null) NativeReaderGallery(initialFile = initial)
                }
            }
        }
    }
}
