package dev.localmed.nativespike.shared.designsystem

import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** One suggestion of the home carousel (web `.home-feature` slide). */
@Immutable
data class NativeFeature(
    val kicker: String,
    val title: String,
    val text: String,
    val primary: NativeCardAction,
    val secondary: NativeCardAction? = null,
    val kickerIcon: (@Composable (tint: Color) -> Unit)? = null,
    val help: (@Composable () -> Unit)? = null,
)

/** Web `USEFUL_FEATURES_AUTOPLAY_MS`. */
const val NATIVE_FEATURES_AUTOPLAY_MS = 7_000L

/**
 * Web `.carousel.useful-features`: one suggestion at a time with swipe, edge arrows and position
 * dots. Every page takes the tallest suggestion's height (all cards are measured first), so the
 * page below never jumps. Autoplay advances every [autoplayMillis] until the user swipes or taps
 * an arrow or dot, and then stops for good, as on the web.
 */
@Composable
fun NativeFeatureCarousel(
    features: List<NativeFeature>,
    positionLabel: (index: Int, count: Int) -> String,
    previousLabel: String,
    nextLabel: String,
    modifier: Modifier = Modifier,
    autoplayMillis: Long? = NATIVE_FEATURES_AUTOPLAY_MS,
    arrowIcon: @Composable (tint: Color, next: Boolean) -> Unit,
) {
    if (features.isEmpty()) return
    val pager = rememberPagerState { features.size }
    val scope = rememberCoroutineScope()
    var userTookOver by remember { mutableStateOf(false) }
    LaunchedEffect(pager) {
        pager.interactionSource.interactions.collect { if (it is DragInteraction.Start) userTookOver = true }
    }
    LaunchedEffect(autoplayMillis, userTookOver, features.size) {
        if (autoplayMillis == null || userTookOver || features.size < 2) return@LaunchedEffect
        while (true) {
            delay(autoplayMillis)
            pager.animateScrollToPage((pager.currentPage + 1) % features.size)
        }
    }
    fun go(page: Int) {
        userTookOver = true
        scope.launch { pager.animateScrollToPage(page.coerceIn(0, features.lastIndex)) }
    }
    val components = NativeDesign.components
    Column(modifier.fillMaxWidth().testTag("carousel"), verticalArrangement = Arrangement.spacedBy(NativeDimensions.space2)) {
        Box(Modifier.fillMaxWidth()) {
            SubcomposeLayout { constraints ->
                val probe = constraints.copy(minHeight = 0, maxHeight = Constraints.Infinity)
                val tallest = features.indices.maxOf { index ->
                    subcompose("measure-$index") { NativeFeatureCard(features[index]) }
                        .maxOf { it.measure(probe).height }
                }
                val pagerPlaceables = subcompose("pager") {
                    HorizontalPager(pager, Modifier.fillMaxWidth().height(tallest.toDp()), pageSpacing = 12.dp) { page ->
                        NativeFeatureCard(features[page], Modifier.fillMaxHeight())
                    }
                }.map { it.measure(constraints.copy(minHeight = tallest, maxHeight = tallest)) }
                layout(constraints.maxWidth, tallest) { pagerPlaceables.forEach { it.place(0, 0) } }
            }
            // Web: the arrows sit on the card edges, half outside.
            val arrow = components.carouselArrow
            val halfOut = ((arrow.width ?: 24.dp) / 2)
            if (pager.currentPage > 0) {
                NativeIconButton(arrow, "carousel-arrow", previousLabel, { go(pager.currentPage - 1) }, Modifier.align(Alignment.CenterStart).offset(x = -halfOut)) {
                    arrowIcon(it, false)
                }
            }
            if (pager.currentPage < features.lastIndex) {
                NativeIconButton(arrow, "carousel-arrow", nextLabel, { go(pager.currentPage + 1) }, Modifier.align(Alignment.CenterEnd).offset(x = halfOut)) {
                    arrowIcon(it, true)
                }
            }
        }
        NativeCarouselDots(
            count = features.size,
            selected = pager.currentPage,
            onSelect = ::go,
            description = { positionLabel(it, features.size) },
            modifier = Modifier.align(Alignment.CenterHorizontally),
        )
    }
}

@Composable
private fun NativeFeatureCard(feature: NativeFeature, modifier: Modifier = Modifier) {
    NativeFeatureCard(
        kicker = feature.kicker,
        title = feature.title,
        text = feature.text,
        primary = feature.primary,
        modifier = modifier,
        secondary = feature.secondary,
        kickerIcon = feature.kickerIcon,
        help = feature.help,
    )
}
