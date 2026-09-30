package dev.localmed.nativespike.shared.designsystem

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.reader.NativePdfPages
import dev.localmed.nativespike.shared.reader.NativeReaderContent
import dev.localmed.nativespike.shared.reader.nativePdfSupported
import org.jetbrains.compose.resources.decodeToImageBitmap
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/**
 * A file the user opened, in the reader: text formats through [NativeDocumentReader], PDF through
 * the platform page renderer, anything else as a plain explanation. Images embedded as `data:`
 * URIs are shown; relative image paths of a single file have nothing to resolve against and show
 * their alternative text.
 */
@Composable
fun NativeFileReader(
    content: NativeReaderContent,
    onBack: () -> Unit,
    glyphs: NativeReaderGlyphs,
    modifier: Modifier = Modifier,
    windowInsets: WindowInsets = WindowInsets(0),
    onExternalLink: (String) -> Unit = nativeOpenExternalLink(),
    tools: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = {},
) {
    when (content) {
        is NativeReaderContent.Document -> NativeDocumentReader(
            content.title,
            content.document,
            onBack,
            glyphs,
            modifier,
            windowInsets = windowInsets,
            onExternalLink = onExternalLink,
            image = { source, alt, frame -> NativeDataImage(source, alt, frame) },
            tools = tools,
        )
        is NativeReaderContent.Pdf -> NativePdfReader(content, onBack, glyphs, modifier, tools)
        is NativeReaderContent.Unsupported -> NativeReaderNotice(content.title, content.reason, onBack, glyphs, modifier, tools)
    }
}

@Composable
private fun NativePdfReader(
    content: NativeReaderContent.Pdf,
    onBack: () -> Unit,
    glyphs: NativeReaderGlyphs,
    modifier: Modifier,
    tools: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit,
) {
    if (!nativePdfSupported) {
        NativeReaderNotice(content.title, "PDF открывается в приложении на Android; в этой сборке страницы не рисуются.", onBack, glyphs, modifier, tools)
        return
    }
    val colors = NativeDesign.colors
    var page by remember(content) { mutableIntStateOf(0) }
    var count by remember(content) { mutableIntStateOf(0) }
    var failure by remember(content) { mutableStateOf<String?>(null) }
    failure?.let {
        NativeReaderNotice(content.title, it, onBack, glyphs, modifier, tools)
        return
    }
    Box(modifier.fillMaxSize().background(colors.surfaceMuted)) {
        NativePdfPages(
            content.bytes,
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(top = 72.dp, bottom = 32.dp, start = 8.dp, end = 8.dp),
            onPage = { top, total -> page = top; count = total },
            onError = { failure = it },
        )
        val paper = NativeDesign.components.readerPaper.background
        Column(
            Modifier.fillMaxWidth().background(paper).drawBehind {
                drawLine(colors.border, Offset(0f, size.height - 0.5f), Offset(size.width, size.height - 0.5f), 1.dp.toPx())
            },
        ) {
            NativeReaderTopBar(content.title, onBack, glyphs.back) {
                tools()
                if (count > 0) {
                    BasicText("${page + 1} / $count", style = NativeDesign.components.resultPath.text.textStyle())
                }
            }
        }
    }
}

/** A reader page that explains why a file is not shown, with the way back. */
@Composable
fun NativeReaderNotice(
    title: String,
    message: String,
    onBack: () -> Unit,
    glyphs: NativeReaderGlyphs,
    modifier: Modifier = Modifier,
    tools: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = {},
) {
    val components = NativeDesign.components
    Column(modifier.fillMaxSize().background(components.readerPaper.background)) {
        NativeReaderTopBar(title, onBack, glyphs.back, tools = tools)
        Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.TopCenter) {
            BasicText(
                message,
                Modifier.widthIn(max = 480.dp).padding(top = 32.dp),
                style = components.readerParagraph.text.textStyle().copy(textAlign = TextAlign.Center, color = NativeDesign.colors.textMuted),
            )
        }
    }
}

/** A `data:image/…;base64,` image; any other source shows its alternative text. */
@OptIn(ExperimentalEncodingApi::class)
@Composable
fun NativeDataImage(source: String, alt: String, modifier: Modifier = Modifier) {
    val bitmap: ImageBitmap? = remember(source) {
        val comma = source.indexOf(',')
        if (!source.startsWith("data:image/") || comma < 0 || !source.substring(0, comma).endsWith(";base64")) {
            null
        } else {
            // Untrusted bytes: a broken image shows its alternative text, as a browser does.
            try {
                Base64.decode(source.substring(comma + 1).filterNot(Char::isWhitespace)).decodeToImageBitmap()
            } catch (_: Exception) {
                null
            }
        }
    }
    if (bitmap != null) {
        Image(bitmap, alt, modifier, contentScale = ContentScale.Fit)
    } else {
        val colors = NativeDesign.colors
        BasicText(
            alt.ifBlank { "Изображение" },
            modifier.fillMaxWidth().background(colors.surfaceMuted).padding(12.dp),
            style = NativeDesign.components.readerImageCaption.text.textStyle(),
        )
    }
}
