package dev.localmed.nativespike.shared.designsystem

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.IndicationNodeFactory
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.node.DelegatableNode
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.node.invalidateDraw
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** Web `:active`: controls sink by 0.1rem. */
val NATIVE_PRESS_SINK = 1.6.dp

/** Web `:active` shadow: the raised outer shadows give way to one pressed-in shadow. */
fun NativeBoxStyle.pressedIn(strong: Boolean = false): NativeBoxStyle = copy(
    shadows = listOf(NativeShadowLayer(inset = true, x = 0.dp, y = 0.8.dp, blur = 2.4.dp, spread = 0.dp, color = Color.Black.copy(alpha = if (strong) .25f else .18f))),
)

/**
 * A pressable control box — frame, interaction, padding — that sinks and presses its shadow in
 * while held, like the WebView buttons, with no ripple. [interaction] attaches `clickable`,
 * `toggleable` or `selectable` with the given source and `indication = null`.
 */
@Composable
fun Modifier.nativePressBox(
    style: NativeBoxStyle,
    enabled: Boolean = true,
    strong: Boolean = false,
    interaction: Modifier.(MutableInteractionSource) -> Modifier,
): Modifier {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val down = pressed && enabled
    val sink by animateDpAsState(if (down) NATIVE_PRESS_SINK else 0.dp, tween(if (down) 40 else 120), label = "press")
    return this
        .graphicsLayer { translationY = sink.toPx() }
        .nativeBoxFrame(if (down) style.pressedIn(strong) else style)
        .interaction(source)
        .nativePadding(style)
}

/**
 * The app's default press feedback for rows, cards and anything not drawn as a raised control:
 * a faint shade while pressed, instead of the Material ripple.
 */
object NativePressShade : IndicationNodeFactory {
    override fun create(interactionSource: InteractionSource): DelegatableNode = PressShadeNode(interactionSource)
    override fun equals(other: Any?): Boolean = other === this
    override fun hashCode(): Int = 7_107
}

private class PressShadeNode(private val source: InteractionSource) : Modifier.Node(), DrawModifierNode {
    private var presses = 0

    override fun onAttach() {
        coroutineScope.launch {
            source.interactions.collect { interaction ->
                val before = presses > 0
                when (interaction) {
                    is PressInteraction.Press -> presses++
                    is PressInteraction.Release, is PressInteraction.Cancel -> presses = (presses - 1).coerceAtLeast(0)
                }
                if (before != presses > 0) invalidateDraw()
            }
        }
    }

    override fun ContentDrawScope.draw() {
        drawContent()
        if (presses > 0) drawRect(Color.Black.copy(alpha = 0.06f))
    }
}
