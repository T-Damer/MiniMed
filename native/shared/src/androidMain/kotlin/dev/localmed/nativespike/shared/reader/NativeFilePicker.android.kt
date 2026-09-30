package dev.localmed.nativespike.shared.reader

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

actual val nativeFilePickerAvailable: Boolean = true

@Composable
actual fun rememberNativeFilePicker(onResult: (NativeFilePick) -> Unit): () -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val latest by rememberUpdatedState(onResult)
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) {
            latest(NativeFilePick.Cancelled)
            return@rememberLauncherForActivityResult
        }
        scope.launch {
            val result = try {
                NativeFilePick.Picked(withContext(Dispatchers.IO) { readDocument(context, uri) })
            } catch (cause: CancellationException) {
                throw cause
            } catch (cause: Exception) {
                NativeFilePick.Failed(cause.message ?: "Не удалось прочитать файл.")
            }
            latest(result)
        }
    }
    // Every type: the reader explains a format it cannot open instead of hiding the file.
    return remember(launcher) { { launcher.launch(arrayOf("*/*")) } }
}

/** Reads a `content:` or `file:` [uri] the system handed over (picker, «open with»). Blocking I/O. */
fun readDocument(context: Context, uri: Uri): NativeOpenedFile {
    val resolver = context.contentResolver
    var name = uri.lastPathSegment ?: "file"
    var size = -1L
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            cursor.getString(0)?.let { name = it }
            if (!cursor.isNull(1)) size = cursor.getLong(1)
        }
    }
    if (size > NATIVE_MAX_OPENED_FILE_BYTES) throw IllegalStateException("Файл больше 256 МБ.")
    val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: throw IllegalStateException("Файл недоступен.")
    return NativeOpenedFile(name, resolver.getType(uri), bytes)
}

actual val nativePdfSupported: Boolean = true

/** One `PdfRenderer` per document; it may open one page at a time, so all rendering is serial. */
private class PdfDocument(context: Context, bytes: ByteArray) : AutoCloseable {
    private val file = File(context.cacheDir, "reader-${UUID.randomUUID()}.pdf").apply { writeBytes(bytes) }
    private val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    private val renderer = PdfRenderer(descriptor)

    /** Width ÷ height of every page, read once. */
    val ratios: List<Float> = (0 until renderer.pageCount).map { index ->
        renderer.openPage(index).use { page -> page.width.toFloat() / page.height.coerceAtLeast(1) }
    }

    @Synchronized
    fun render(index: Int, widthPx: Int): Bitmap = renderer.openPage(index).use { page ->
        val width = widthPx.coerceIn(1, MAX_PAGE_WIDTH)
        val height = (width / ratios[index]).toInt().coerceAtLeast(1)
        Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { bitmap ->
            bitmap.eraseColor(Color.WHITE)
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
        }
    }

    override fun close() {
        renderer.close()
        descriptor.close()
        file.delete()
    }

    private companion object {
        const val MAX_PAGE_WIDTH = 2400
    }
}

/** One thread for one document: `PdfRenderer` opens a single page at a time. */
@OptIn(ExperimentalCoroutinesApi::class)
private fun serialRenderDispatcher() = Dispatchers.IO.limitedParallelism(1)

@Composable
actual fun NativePdfPages(bytes: ByteArray, modifier: Modifier, contentPadding: PaddingValues, onPage: (page: Int, count: Int) -> Unit, onError: (message: String) -> Unit) {
    val context = LocalContext.current
    val renderDispatcher = remember { serialRenderDispatcher() }
    val document by produceState<Result<PdfDocument>?>(null, bytes) {
        value = try {
            Result.success(withContext(renderDispatcher) { PdfDocument(context, bytes) })
        } catch (cause: CancellationException) {
            throw cause
        } catch (cause: Exception) {
            Result.failure(cause)
        }
    }
    DisposableEffect(document) {
        val opened = document?.getOrNull()
        onDispose { opened?.close() }
    }
    val latestOnError by rememberUpdatedState(onError)
    LaunchedEffect(document) {
        document?.exceptionOrNull()?.let { latestOnError("PDF не открывается: файл повреждён или защищён паролем.") }
    }
    val pdf = document?.getOrNull()
    if (pdf == null) {
        Box(modifier.fillMaxSize())
        return
    }
    val list = rememberLazyListState()
    val latestOnPage by rememberUpdatedState(onPage)
    LaunchedEffect(pdf) {
        snapshotFlow { list.firstVisibleItemIndex }.collect { latestOnPage(it, pdf.ratios.size) }
    }
    var width by remember { mutableStateOf(0) }
    var zoom by remember { mutableFloatStateOf(1f) }
    var shift by remember { mutableFloatStateOf(0f) }
    // Pinch zooms up to 4×; while zoomed, a drag pans sideways and scrolls the pages.
    val transform = rememberTransformableState { change, pan, _ ->
        zoom = (zoom * change).coerceIn(1f, 4f)
        val limit = width * (zoom - 1f) / 2f
        shift = (shift + pan.x).coerceIn(-limit, limit)
        if (zoom > 1f) list.dispatchRawDelta(-pan.y / zoom)
    }
    LazyColumn(
        modifier
            .fillMaxSize()
            .onSizeChanged { width = it.width }
            .transformable(transform, canPan = { zoom > 1f })
            .graphicsLayer {
                scaleX = zoom
                scaleY = zoom
                translationX = shift
            },
        state = list,
        contentPadding = contentPadding,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        itemsIndexed(pdf.ratios) { index, ratio ->
            // Pages render at twice the view width, so moderate zoom stays sharp.
            val bitmap by produceState<Bitmap?>(null, pdf, index, width) {
                if (width > 0) value = withContext(renderDispatcher) { pdf.render(index, width * 2) }
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(ratio)
                    .background(androidx.compose.ui.graphics.Color.White)
                    .semantics { contentDescription = "Страница ${index + 1} из ${pdf.ratios.size}" },
            ) {
                bitmap?.let { Image(it.asImageBitmap(), contentDescription = null, modifier = Modifier.fillMaxSize()) }
            }
        }
    }
}
