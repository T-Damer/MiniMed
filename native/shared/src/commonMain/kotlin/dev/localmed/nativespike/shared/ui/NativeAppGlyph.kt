package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/** The same filled vector paths as WebView; no emoji, platform icon substitutions or bitmap scale. */
@Composable
fun NativeAppGlyph(
    glyph: NativeAppGlyphName, modifier: Modifier = Modifier.size(24.dp),
    tint: Color = LocalContentColor.current, contentDescription: String? = null,
) {
    val vector = remember(glyph) {
        ImageVector.Builder(glyph.webName, 24.dp, 24.dp, 256f, 256f).apply {
            glyph.paths.forEach { path -> addPath(
                pathData = PathParser().parsePathString(path.data).toNodes(), fill = SolidColor(Color.Black),
                pathFillType = if (path.evenOdd) PathFillType.EvenOdd else PathFillType.NonZero,
            ) }
        }.build()
    }
    Icon(vector, contentDescription, modifier, tint)
}
