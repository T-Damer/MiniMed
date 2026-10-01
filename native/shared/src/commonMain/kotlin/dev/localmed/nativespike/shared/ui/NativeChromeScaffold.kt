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
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.layer.CompositingStrategy
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp

/**
 * Sticky route chrome over a scrolling scene, as frosted glass (user decision 2026-10-01): once
 * the scene scrolls, the part of it under the controls and the status bar is shown blurred by 16 dp
 * — the web `backdrop-filter: blur(1rem)` — and the glass fades out over [FADE] below them. The
 * glass is painted with the page background under the blurred scene, so it fully covers the sharp
 * text beneath; no tint and no grain. Only the strip is blurred, not the whole scene. Platforms
 * without nested-layer blur ([nativeBlurBackdrop]) show a translucent strip instead.
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
    val scene = rememberGraphicsLayer()
    val glass = rememberGraphicsLayer()
    val masked = rememberGraphicsLayer()
    var headerHeight by remember { mutableIntStateOf(0) }
    val fade = with(density) { FADE.toPx() }
    val blur = with(density) { BLUR.toPx() }
    val padding = PaddingValues(top = with(density) { headerHeight.toDp() }, bottom = LocalNativeNavigationPadding.current)
    val shown by animateFloatAsState(if (scrolled) 1f else 0f, tween(180), label = "chrome-glass")
    val deskBrush = nativeRouteDeskBrush()
    val nativeDeskTop = nativeRouteDeskTopColor()
    Box(Modifier.fillMaxSize().then(if (desk) Modifier.background(deskBrush) else Modifier.background(containerColor))) {
        Box(
            Modifier.fillMaxSize().drawWithContent {
                scene.record { this@drawWithContent.drawContent() }
                drawLayer(scene)
            },
        ) { content(padding) }
        Box(
            Modifier.fillMaxWidth().onSizeChanged { headerHeight = it.height }.drawWithContent {
                if (shown > 0f && headerHeight > 0 && !nativeBlurBackdrop) {
                    // Skiko targets: a translucent strip in the page colour, fading the same way.
                    val controls = headerHeight.toFloat()
                    val tint = (if (desk) nativeDeskTop else containerColor).copy(alpha = TINT * shown)
                    drawRect(tint, size = androidx.compose.ui.geometry.Size(size.width, controls))
                    drawRect(
                        Brush.verticalGradient(listOf(tint, Color.Transparent), startY = controls, endY = controls + fade),
                        topLeft = androidx.compose.ui.geometry.Offset(0f, controls),
                        size = androidx.compose.ui.geometry.Size(size.width, fade),
                    )
                } else if (shown > 0f && scene.size.width > 0 && headerHeight > 0) {
                    val controls = headerHeight.toFloat()
                    val strip = IntSize(scene.size.width, (controls + fade).toInt())
                    glass.clip = true
                    glass.renderEffect = BlurEffect(blur, blur, TileMode.Clamp)
                    // The page background goes into the glass too, so the blurred strip is opaque
                    // and the sharp text beneath does not show through it.
                    glass.record(size = strip) {
                        if (desk) drawRect(deskBrush, size = androidx.compose.ui.geometry.Size(size.width, scene.size.height.toFloat())) else drawRect(containerColor)
                        drawLayer(scene)
                    }
                    masked.compositingStrategy = CompositingStrategy.Offscreen
                    masked.alpha = shown
                    masked.record(size = strip) {
                        drawLayer(glass)
                        // Solid behind the controls, then fading out like the web mask.
                        drawRect(
                            Brush.verticalGradient(listOf(Color.White, Color.Transparent), startY = controls, endY = controls + fade),
                            blendMode = BlendMode.DstIn,
                        )
                    }
                    clipRect(bottom = controls + fade) { drawLayer(masked) }
                }
                drawContent()
            },
        ) { topBar() }
    }
}

private val FADE = 20.dp
private const val TINT = 0.86f
private val BLUR = 16.dp
