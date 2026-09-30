package dev.localmed.nativespike.shared.ui

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
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.layer.CompositingStrategy
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp

/** Records only the scrollable scene: controls never blur themselves or feed back into it. */
@Composable
fun NativeChromeScaffold(
    containerColor: Color,
    topBar: @Composable () -> Unit,
    scrolled: Boolean = true,
    topBarTintAlpha: Float = 0.76f,
    desk: Boolean = false,
    content: @Composable (PaddingValues) -> Unit,
) {
    val scene = rememberGraphicsLayer()
    val blurred = rememberGraphicsLayer()
    val material = rememberGraphicsLayer()
    val density = LocalDensity.current
    var headerHeight by remember { mutableIntStateOf(0) }
    val fade = with(density) { 10.dp.toPx() }
    val blurRadius = with(density) { 12.dp.toPx() }
    val grainStep = with(density) { 2.dp.toPx() }
    val padding = PaddingValues(top = with(density) { headerHeight.toDp() }, bottom = LocalNativeNavigationPadding.current)
    val backdropColor = if (desk) nativeRouteDeskColor() else containerColor
    Box(Modifier.fillMaxSize().then(if (desk) Modifier.background(nativeRouteDeskBrush()) else Modifier.background(containerColor))) {
        Box(Modifier.fillMaxSize().drawWithContent {
            scene.record { this@drawWithContent.drawContent() }
            drawLayer(scene)
        }) { content(padding) }
        Box(Modifier.fillMaxWidth().onSizeChanged { headerHeight = it.height }.drawWithContent {
            if (scrolled && scene.size.width > 0 && headerHeight > 0) {
                val strip = IntSize(scene.size.width, (headerHeight + fade).toInt())
                blurred.clip = true
                blurred.renderEffect = BlurEffect(blurRadius, blurRadius, TileMode.Clamp)
                blurred.record(size = strip) { drawLayer(scene) }
                material.compositingStrategy = CompositingStrategy.Offscreen
                material.record(size = strip) {
                    drawLayer(blurred)
                    drawRect(backdropColor.copy(alpha = topBarTintAlpha))
                    // Fixed noise moves with the material, never flickers between frames.
                    var y = 0f
                    var row = 0
                    while (y < size.height) {
                        var x = 0f
                        var column = 0
                        while (x < size.width) {
                            var noise = (column * 374761393) xor (row * 668265263)
                            noise = (noise xor (noise ushr 13)) * 1274126177
                            val sample = (noise xor (noise ushr 16)) and 255
                            if (sample and 3 == 0) drawCircle(
                                if (sample and 4 == 0) Color.Black.copy(alpha = .035f) else Color.White.copy(alpha = .035f),
                                radius = grainStep * .22f,
                                center = androidx.compose.ui.geometry.Offset(x, y),
                            )
                            x += grainStep
                            column++
                        }
                        y += grainStep
                        row++
                    }
                    drawRect(Brush.verticalGradient(
                        listOf(Color.White, Color.Transparent),
                        startY = headerHeight.toFloat(), endY = size.height,
                    ), blendMode = BlendMode.DstIn)
                }
                clipRect(bottom = headerHeight + fade) { drawLayer(material) }
            }
            drawContent()
        }) { topBar() }
    }
}
