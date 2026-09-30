package dev.localmed.nativespike.shared.designsystem

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * CSS `display: flex` with children `flex: 1 1 auto` on one line: each child starts from its
 * natural width, free space is shared equally, a shortfall shrinks them in proportion to that
 * width, and all children take the tallest child's height.
 */
@Composable
fun NativeFlexRow(gap: Dp, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Layout(content, modifier) { measurables, constraints ->
        if (measurables.isEmpty()) return@Layout layout(0, 0) {}
        val gapPx = gap.roundToPx()
        val available = if (constraints.hasBoundedWidth) constraints.maxWidth else Int.MAX_VALUE
        val bases = measurables.map { it.maxIntrinsicWidth(Constraints.Infinity) }
        val totalGap = gapPx * (measurables.size - 1)
        val free = available - bases.sum() - totalGap
        val widths = if (available == Int.MAX_VALUE) {
            bases
        } else if (free >= 0) {
            bases.map { it + free / measurables.size }
        } else {
            val total = bases.sum().coerceAtLeast(1)
            bases.map { (it + free * it / total.toFloat()).roundToInt().coerceAtLeast(0) }
        }
        val height = measurables.indices
            .maxOf { measurables[it].maxIntrinsicHeight(widths[it]) }
            .coerceIn(constraints.minHeight, constraints.maxHeight)
        val placeables = measurables.mapIndexed { index, measurable ->
            measurable.measure(Constraints.fixed(widths[index], height))
        }
        val width = placeables.sumOf { it.width } + totalGap
        layout(max(width, constraints.minWidth), height) {
            var x = 0
            placeables.forEach { placeable ->
                placeable.placeRelative(x, 0)
                x += placeable.width + gapPx
            }
        }
    }
}
