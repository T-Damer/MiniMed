package dev.localmed.nativespike.shared.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp

/**
 * Sticky route chrome over a scrolling scene. Once the scene scrolls, an opaque strip in the
 * route's own colour sits behind the controls (including the status bar) and fades out just below
 * them. No blur and no grain (user decision 2026-09-30, docs/NATIVE_STICKY_CHROME.md): they looked
 * muddy and re-rendered the whole scene every frame.
 */
@Composable
fun NativeChromeScaffold(
    containerColor: Color,
    topBar: @Composable () -> Unit,
    scrolled: Boolean = true,
    desk: Boolean = false,
    content: @Composable (PaddingValues) -> Unit,
) {
    val density = LocalDensity.current
    var headerHeight by remember { mutableIntStateOf(0) }
    val fade = with(density) { FADE.toPx() }
    val padding = PaddingValues(top = with(density) { headerHeight.toDp() }, bottom = LocalNativeNavigationPadding.current)
    // The strip matches what it covers: the top of the desk gradient, or the route's surface.
    val strip = if (desk) nativeRouteDeskTopColor() else containerColor
    val shown by animateFloatAsState(if (scrolled) 1f else 0f, tween(160), label = "chrome-strip")
    Box(Modifier.fillMaxSize().then(if (desk) Modifier.background(nativeRouteDeskBrush()) else Modifier.background(containerColor))) {
        Box(Modifier.fillMaxSize()) { content(padding) }
        Box(
            Modifier.fillMaxWidth().onSizeChanged { headerHeight = it.height }.drawBehind {
                if (shown > 0f) {
                    val solid = strip.copy(alpha = strip.alpha * shown)
                    drawRect(solid, size = Size(size.width, size.height))
                    drawRect(
                        Brush.verticalGradient(listOf(solid, Color.Transparent), startY = size.height, endY = size.height + fade),
                        topLeft = Offset(0f, size.height),
                        size = Size(size.width, fade),
                    )
                }
            },
        ) { topBar() }
    }
}

private val FADE = 12.dp
