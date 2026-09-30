package dev.localmed.nativespike.shared.designsystem

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
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

/** Web `.app-bottom-nav`: the floating pill holding the section buttons. */
@Composable
fun NativeBottomNav(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    val style = NativeDesign.components.bottomNav
    Row(
        modifier.testTag("bottom-nav").nativeBox(style),
        horizontalArrangement = Arrangement.spacedBy(style.columnGap),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** Web `.app-nav-button` / `--active`. */
@Composable
fun NativeBottomNavButton(
    selected: Boolean,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: @Composable (tint: Color) -> Unit,
) {
    val components = NativeDesign.components
    val style = if (selected) components.bottomNavButtonActive else components.bottomNavButton
    Box(
        modifier
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
