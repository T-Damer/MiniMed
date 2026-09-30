package dev.localmed.nativespike.shared.designsystem

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.IntOffset
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sign
import kotlinx.coroutines.launch
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** One destination of the bottom navigation. */
@Immutable
data class NativeNavItem(
    val contentDescription: String,
    val icon: @Composable (tint: Color) -> Unit,
)

/** Web bubble motion: `cubic-bezier(0.34, 1.56, 0.64, 1)` over 420 ms, an overshooting settle. */
private val BubbleEasing = CubicBezierEasing(0.34f, 1.56f, 0.64f, 1f)
private const val BUBBLE_TRAVEL_MS = 420

/**
 * Web `.app-bottom-nav` with its `__bubble`: the selected destination sits in a raised paper
 * circle. Tapping moves the bubble with an overshoot and a speed-dependent stretch; dragging along
 * the pill carries the bubble under the finger (rubber-band past the ends, a tick at each new
 * destination) and selects the nearest destination on release — as in the web use-bottom-nav.ts.
 */
@Composable
fun NativeBottomNav(
    items: List<NativeNavItem>,
    selected: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val components = NativeDesign.components
    val nav = components.bottomNav
    val button = components.bottomNavButton
    val buttonWidth = button.width ?: 44.dp
    val gap = nav.columnGap
    val density = LocalDensity.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val currentOnSelect by rememberUpdatedState(onSelect)

    fun centerOf(index: Int): Float = with(density) { (buttonWidth.toPx() + gap.toPx()) * index + buttonWidth.toPx() / 2 }
    fun nearest(center: Float): Int = items.indices.minByOrNull { abs(centerOf(it) - center) } ?: 0

    val bubbleCenter = remember { Animatable(centerOf(selected)) }
    val scaleX = remember { Animatable(1f) }
    val scaleY = remember { Animatable(1f) }
    val rotation = remember { Animatable(0f) }
    var dragging by remember { mutableStateOf(false) }
    var dragIndex by remember { mutableStateOf<Int?>(null) }

    LaunchedEffect(selected) {
        if (dragging) return@LaunchedEffect
        val target = centerOf(selected)
        val dx = target - bubbleCenter.value
        val speed = min(1f, abs(dx) / with(density) { 64.dp.toPx() })
        if (speed > 0.06f) {
            val direction = sign(dx)
            scaleX.snapTo(1 + speed * 0.58f)
            scaleY.snapTo(1 - speed * 0.16f)
            rotation.snapTo(direction * speed * 7f)
        }
        launch { bubbleCenter.animateTo(target, tween(BUBBLE_TRAVEL_MS, easing = BubbleEasing)) }
        val settle = spring<Float>(dampingRatio = 0.55f, stiffness = Spring.StiffnessMediumLow)
        launch { scaleX.animateTo(1f, settle) }
        launch { scaleY.animateTo(1f, settle) }
        launch { rotation.animateTo(0f, settle) }
    }

    val inset = nav.padding.start + nav.borderWidth
    Box(
        modifier
            .testTag("bottom-nav")
            .nativeBoxFrame(nav)
            .pointerInput(items.size) {
                val insetPx = inset.toPx()
                val first = centerOf(0)
                val last = centerOf(items.lastIndex)
                val reach = buttonWidth.toPx() * 0.35f
                var finger = 0f
                var velocity = 0f
                var lastTime = 0L
                detectHorizontalDragGestures(
                    onDragStart = { start ->
                        dragging = true
                        finger = start.x - insetPx
                        velocity = 0f
                        lastTime = -1L
                        dragIndex = nearest(finger)
                    },
                    onDragEnd = {
                        val index = nearest(bubbleCenter.value)
                        dragging = false
                        dragIndex = null
                        if (index != selected) {
                            currentOnSelect(index)
                        } else {
                            scope.launch { bubbleCenter.animateTo(centerOf(index), tween(BUBBLE_TRAVEL_MS, easing = BubbleEasing)) }
                        }
                        val settle = spring<Float>(dampingRatio = 0.55f, stiffness = Spring.StiffnessMediumLow)
                        scope.launch { scaleX.animateTo(1f, settle) }
                        scope.launch { scaleY.animateTo(1f, settle) }
                        scope.launch { rotation.animateTo(0f, settle) }
                    },
                    onDragCancel = {
                        dragging = false
                        dragIndex = null
                        scope.launch { bubbleCenter.animateTo(centerOf(selected), tween(BUBBLE_TRAVEL_MS, easing = BubbleEasing)) }
                    },
                ) { change, dx ->
                    change.consume()
                    finger += dx
                    val now = change.uptimeMillis
                    val elapsed = if (lastTime < 0) 16f else max(8L, now - lastTime).toFloat()
                    lastTime = now
                    val raw = min(1f, abs(dx) / density.density / elapsed / 0.8f)
                    velocity += (raw - velocity) * 0.35f
                    // Past the first/last destination the bubble follows with resistance.
                    val beyond = when {
                        finger < first -> finger - first
                        finger > last -> finger - last
                        else -> 0f
                    }
                    val resisted = sign(beyond) * reach * (1 - 1 / (abs(beyond) / (80 * density.density) + 1))
                    val overscroll = if (reach > 0f) abs(resisted) / reach else 0f
                    val center = finger.coerceIn(first, last) + resisted
                    scope.launch {
                        bubbleCenter.snapTo(center)
                        scaleX.snapTo(1 + velocity * 0.45f + overscroll * 0.18f)
                        scaleY.snapTo(1 - velocity * 0.14f - overscroll * 0.08f)
                        rotation.snapTo(sign(dx) * velocity * 6f)
                    }
                    val index = nearest(center)
                    if (index != dragIndex) {
                        dragIndex = index
                        haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                    }
                }
            }
            .nativePadding(nav),
    ) {
        val bubble = components.bottomNavBubble
        val raised = NativeDesign.colors.surfaceRaised
        Box(
            Modifier
                .testTag("bottom-nav-bubble")
                .offset { IntOffset((bubbleCenter.value - buttonWidth.toPx() / 2).roundToInt(), 0) }
                .graphicsLayer {
                    this.scaleX = scaleX.value
                    this.scaleY = scaleY.value
                    rotationZ = rotation.value
                }
                .nativeBoxFrame(bubble)
                .drawBehind {
                    // Web: radial highlight at 35% 18% over a 145° raised-paper gradient.
                    drawRect(
                        Brush.linearGradient(
                            listOf(lerp(raised, Color.White, 0.12f), raised),
                            start = Offset(size.width * 0.21f, 0f),
                            end = Offset(size.width * 0.79f, size.height),
                        ),
                    )
                    val highlight = Offset(size.width * 0.35f, size.height * 0.18f)
                    val farthest = hypot(max(highlight.x, size.width - highlight.x), max(highlight.y, size.height - highlight.y))
                    drawRect(
                        Brush.radialGradient(
                            0f to Color.White.copy(alpha = 0.72f),
                            0.58f to Color.Transparent,
                            center = highlight,
                            radius = farthest,
                        ),
                    )
                },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(gap), verticalAlignment = Alignment.CenterVertically) {
            items.forEachIndexed { index, item ->
                NativeBottomNavButton(
                    selected = index == (dragIndex ?: selected),
                    contentDescription = item.contentDescription,
                    onClick = { currentOnSelect(index) },
                    icon = item.icon,
                )
            }
        }
    }
}

/** Web `.app-nav-button` / `--active`: a transparent 44 dp target over the bubble. */
@Composable
private fun NativeBottomNavButton(
    selected: Boolean,
    contentDescription: String,
    onClick: () -> Unit,
    icon: @Composable (tint: Color) -> Unit,
) {
    val components = NativeDesign.components
    val style = if (selected) components.bottomNavButtonActive else components.bottomNavButton
    Box(
        Modifier
            .testTag(if (selected) "bottom-nav-button-active" else "bottom-nav-button")
            .nativeBoxFrame(style)
            .semantics { this.contentDescription = contentDescription }
            .selectable(selected = selected, role = Role.Tab, onClick = onClick)
            .nativePadding(style),
        contentAlignment = Alignment.Center,
    ) { icon(style.text.color) }
}

/**
 * Web `.carousel__dots`: 20 px hit areas whose 6 px padding frames the visible pill
 * (`background-clip: content-box`); the active dot widens to 30 px. Width and colour change over
 * 200 ms ease-out, as in Carousel.css.
 */
@Composable
fun NativeCarouselDots(
    count: Int,
    selected: Int,
    onSelect: (Int) -> Unit,
    description: (Int) -> String,
    modifier: Modifier = Modifier,
) {
    val components = NativeDesign.components
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        repeat(count) { index ->
            val active = index == selected
            val style = if (active) components.carouselDotActive else components.carouselDot
            val motion = tween<Dp>(durationMillis = 200, easing = LinearOutSlowInEasing)
            val width by animateDpAsState(style.width ?: 0.dp, motion)
            val color by animateColorAsState(style.background, tween(200, easing = LinearOutSlowInEasing))
            Box(
                Modifier
                    .testTag(if (active) "carousel-dot-active" else "carousel-dot")
                    .semantics { contentDescription = description(index) }
                    .clickable(role = Role.Tab) { onSelect(index) }
                    .size(width, style.height ?: 0.dp)
                    .padding(
                        start = style.padding.start,
                        top = style.padding.top,
                        end = style.padding.end,
                        bottom = style.padding.bottom,
                    ),
            ) {
                Box(Modifier.fillMaxSize().background(color, style.shape()))
            }
        }
    }
}
