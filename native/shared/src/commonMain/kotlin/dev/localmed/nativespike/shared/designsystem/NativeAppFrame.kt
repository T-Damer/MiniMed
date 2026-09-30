package dev.localmed.nativespike.shared.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Web page geometry (`compact-release.css`): above 760 px the page is `min(100% − 32px, 1152px)`. */
object NativeLayout {
    val wideBreakpoint: Dp = 760.dp
    val pageMaxWidth: Dp = 1152.dp
    val pageMargin: Dp = 16.dp

    /** The page width for a window [available] wide. */
    fun pageWidth(available: Dp): Dp =
        if (available < wideBreakpoint) available else minOf(available - pageMargin * 2, pageMaxWidth)
}

private val LocalNativeAppFramed = compositionLocalOf { false }

/**
 * The whole app as one centred page: on phones it fills the window; on wide windows (tablets,
 * desktop, 21:9) it keeps the web page width and the desk shows on both sides. Nested frames
 * (a screen inside the shell) do nothing.
 */
@Composable
fun NativeAppFrame(desk: Brush, content: @Composable () -> Unit) {
    if (LocalNativeAppFramed.current) {
        content()
        return
    }
    BoxWithConstraints(Modifier.fillMaxSize().background(desk), contentAlignment = Alignment.TopCenter) {
        val page = NativeLayout.pageWidth(maxWidth)
        Box(Modifier.width(page).fillMaxHeight()) {
            CompositionLocalProvider(LocalNativeAppFramed provides true, content = content)
        }
    }
}
