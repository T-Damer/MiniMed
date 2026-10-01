package dev.localmed.nativespike.shared.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.statusBars
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp

/**
 * Sticky route chrome over a scrolling scene (user decision 2026-10-01): no glass, no tint, no
 * grain behind the controls — they float on their own shadows. Only the status bar keeps a strip
 * in the page colour once the scene scrolls, fading over [FADE], so system icons never sit on text.
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
    val padding = PaddingValues(top = with(density) { headerHeight.toDp() }, bottom = LocalNativeNavigationPadding.current)
    val status = with(density) { WindowInsets.statusBars.asPaddingValues().calculateTopPadding().toPx() }
    val fade = with(density) { FADE.toPx() }
    val strip = if (desk) nativeRouteDeskTopColor() else containerColor
    val shown by animateFloatAsState(if (scrolled) 1f else 0f, tween(160), label = "status-strip")
    Box(Modifier.fillMaxSize().then(if (desk) Modifier.background(nativeRouteDeskBrush()) else Modifier.background(containerColor))) {
        Box(Modifier.fillMaxSize()) { content(padding) }
        Box(
            Modifier.fillMaxWidth().onSizeChanged { headerHeight = it.height }.drawWithContent {
                if (shown > 0f && status > 0f) {
                    val solid = strip.copy(alpha = strip.alpha * shown)
                    drawRect(solid, size = Size(size.width, status))
                    drawRect(
                        Brush.verticalGradient(listOf(solid, Color.Transparent), startY = status, endY = status + fade),
                        topLeft = Offset(0f, status),
                        size = Size(size.width, fade),
                    )
                }
                drawContent()
            },
        ) { topBar() }
    }
}

private val FADE = 8.dp
