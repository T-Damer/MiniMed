package dev.localmed.nativespike.shared.tools

import kotlin.math.floor

internal sealed interface ToolVisualResult {
    data class Success(val output: NativeCalculatorOutput.Visual? = null) : ToolVisualResult
    data class Failure(val error: String) : ToolVisualResult
}
internal fun evaluateToolVisual(visual: NativeToolVisual, scope: Map<String, NativeToolInput>, expressions: ToolExpression): ToolVisualResult {
    val datasets = mutableListOf<NativeToolChartDataset>()
    fun evaluate(entry: NativeToolInput, values: Map<String, NativeToolInput>, label: String): Double? {
        val value = try { when(entry) { is NativeToolInput.Number -> entry; is NativeToolInput.Text -> expressions.evaluate(entry.value, values) } } catch(cause: Exception) { throw ToolExpressionError("$label: ${cause.message}") }
        if(value == null) return null
        if(value !is NativeToolInput.Number || !value.value.isFinite()) throw ToolExpressionError("$label не является конечным числом.")
        return value.value
    }
    for(dataset in visual.datasets) {
        val data = mutableListOf<NativeToolChartPoint>()
        try {
            when {
                dataset.data != null -> dataset.data.forEachIndexed { index, entry ->
                    val value = evaluate(entry, scope, "точка ${index + 1}") ?: return ToolVisualResult.Success()
                    data += NativeToolChartPoint.Number(value)
                }
                dataset.points != null -> dataset.points.forEachIndexed { index, point ->
                    val x = evaluate(point.x, scope, "точка ${index + 1}, X") ?: return ToolVisualResult.Success()
                    val y = evaluate(point.y, scope, "точка ${index + 1}, Y") ?: return ToolVisualResult.Success()
                    data += NativeToolChartPoint.XY(x, y)
                }
                dataset.sample != null -> {
                    val sample = dataset.sample; val count = floor((sample.to - sample.from) / sample.step + 1e-9).toInt() + 1
                    repeat(count) { index ->
                        val valueScope = scope + (sample.variable to NativeToolInput.Number(sample.from + index * sample.step))
                        val x = evaluate(NativeToolInput.Text(sample.x), valueScope, "точка ${index + 1}, X") ?: return ToolVisualResult.Success()
                        val y = evaluate(NativeToolInput.Text(sample.y), valueScope, "точка ${index + 1}, Y") ?: return ToolVisualResult.Success()
                        data += NativeToolChartPoint.XY(x, y)
                    }
                }
                else -> return ToolVisualResult.Failure("Визуализация «${visual.title}», ряд «${dataset.label}»: не заданы данные.")
            }
        } catch(cause: Exception) { return ToolVisualResult.Failure("Визуализация «${visual.title}», ряд «${dataset.label}»: ${cause.message}") }
        if(dataset.data != null && visual.labels.isNotEmpty() && visual.labels.size != data.size) return ToolVisualResult.Failure("Визуализация «${visual.title}», ряд «${dataset.label}»: число точек (${data.size}) не совпадает с числом подписей (${visual.labels.size}).")
        datasets += NativeToolChartDataset(dataset.label, data, dataset.render, dataset.tone)
    }
    val chart = NativeToolChart(visual.kind, visual.title, visual.labels, datasets, visual.caption, visual.heightPx, visual.xAxis, visual.yAxis, visual.annotations.takeIf { it.isNotEmpty() })
    return ToolVisualResult.Success(NativeCalculatorOutput.Visual(visual.id, visual.title, chart))
}
