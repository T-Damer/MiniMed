package dev.localmed.nativespike.shared.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.draw.innerShadow
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.DpOffset

fun NativeBoxStyle.shape(): Shape = if (circle) CircleShape else RoundedCornerShape(corner)

private fun NativeShadowLayer.toShadow(): Shadow =
    Shadow(radius = blur, color = color, spread = spread, offset = DpOffset(x, y))

/**
 * Paints a web block's computed box — fixed size, outer shadows, clip, background, inset shadows
 * and border, in CSS painting order — without its padding. Put `clickable`/`toggleable` right
 * after it and [nativePadding] after that: the whole box is the touch target, the ripple is
 * clipped to the shape and outer shadows stay unclipped.
 */
fun Modifier.nativeBoxFrame(style: NativeBoxStyle): Modifier {
    val shape = style.shape()
    var modifier = when {
        style.width != null && style.height != null -> size(style.width, style.height)
        style.height != null -> height(style.height)
        style.minHeight != null -> heightIn(min = style.minHeight)
        else -> this
    }
    // CSS paints the first listed shadow on top; Compose draws later modifiers above earlier ones.
    for (layer in style.shadows.filter { !it.inset }.asReversed()) {
        modifier = modifier.dropShadow(shape, layer.toShadow())
    }
    modifier = modifier.clip(shape).background(style.background, shape)
    for (layer in style.shadows.filter { it.inset }.asReversed()) {
        modifier = modifier.innerShadow(shape, layer.toShadow())
    }
    if (style.borderWidth.value > 0f) modifier = modifier.border(style.borderWidth, style.borderColor, shape)
    return modifier
}

/**
 * The block's CSS padding plus its border: a CSS border takes layout space, while Compose draws
 * `border` inside the bounds, so the content is inset by both, as in the web box model.
 */
fun Modifier.nativePadding(style: NativeBoxStyle): Modifier = padding(
    start = style.padding.start + style.borderWidth,
    top = style.padding.top + style.borderWidth,
    end = style.padding.end + style.borderWidth,
    bottom = style.padding.bottom + style.borderWidth,
)

/** Frame plus padding, for blocks without their own interaction. */
fun Modifier.nativeBox(style: NativeBoxStyle): Modifier = nativeBoxFrame(style).nativePadding(style)

/** The block's text style; numerals stay tabular as in the web root. */
@Composable
fun NativeTextSpec.textStyle(): TextStyle = TextStyle(
    fontFamily = when (role) {
        NativeFontRole.Serif -> NativeFontFamilies.serif
        NativeFontRole.Sans -> NativeFontFamilies.sans
        NativeFontRole.Mono -> nativeMonoFontFamily()
    },
    fontSize = size,
    fontWeight = weight,
    lineHeight = lineHeight,
    letterSpacing = letterSpacing,
    color = color,
    fontFeatureSettings = "tnum",
)

/** Applies the block's `text-transform: uppercase`. */
fun NativeTextSpec.display(text: String): String = if (uppercase) text.uppercase() else text
