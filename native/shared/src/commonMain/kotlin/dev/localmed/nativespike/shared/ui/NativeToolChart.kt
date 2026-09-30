package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.tools.*
import dev.localmed.nativespike.shared.text.jsNumberToString
import kotlin.math.abs

private data class ToolPoint(val x: Double,val y: Double)
private fun chartPoints(dataset: NativeToolChartDataset) = dataset.data.mapIndexed { index,point -> when(point) {
    is NativeToolChartPoint.Number -> ToolPoint(index.toDouble(),point.value)
    is NativeToolChartPoint.XY -> ToolPoint(point.x,point.y)
} }

/** Source chart geometry plus a paged, accessible table of every original point. */
@Composable
fun NativeToolChart(chart: NativeToolChart) {
    val rows=remember(chart) { chart.datasets.map(::chartPoints) }
    val points=remember(rows) { rows.flatten() }
    val xMin=chart.xAxis?.minimum ?: points.minOfOrNull { it.x } ?: 0.0
    val xMax=chart.xAxis?.maximum ?: points.maxOfOrNull { it.x } ?: 1.0
    val yMin=chart.yAxis?.minimum ?: points.minOfOrNull { it.y } ?: 0.0
    val yMax=chart.yAxis?.maximum ?: points.maxOfOrNull { it.y } ?: 1.0
    val colors=MaterialTheme.colorScheme
    val textMeasurer=rememberTextMeasurer()
    val annotationStyle=MaterialTheme.typography.labelSmall.copy(color=colors.onSurface)
    fun tone(value: String?,index: Int): Color = when(value) {
        "danger" -> colors.error
        "neutral" -> colors.onSurface
        "success" -> colors.primary
        "warning" -> colors.onSurfaceVariant
        else -> listOf(colors.primary,colors.error,colors.onSurface,colors.secondary)[index%4]
    }
    var showData by remember(chart) { mutableStateOf(false) }
    var dataPage by remember(chart) { mutableStateOf(0) }
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(6.dp)) {
        Text(chart.title,style=MaterialTheme.typography.titleMedium)
        chart.yAxis?.let { Text("${it.label}: ${it.minimumLabel ?: jsNumberToString(yMin)} — ${it.maximumLabel ?: jsNumberToString(yMax)}",color=colors.onSurfaceVariant) }
        Canvas(Modifier.fillMaxWidth().height((chart.heightPx ?: 260).coerceIn(180,600).dp)) {
            val margin=12.dp.toPx();val width=size.width-2*margin;val height=size.height-2*margin
            fun at(point: ToolPoint): Offset {
                var x=if(xMax==xMin) .5 else (point.x-xMin)/(xMax-xMin)
                var y=if(yMax==yMin) .5 else (point.y-yMin)/(yMax-yMin)
                if(chart.xAxis?.reverse==true) x=1-x
                if(chart.yAxis?.reverse==true) y=1-y
                return Offset(margin+(x*width).toFloat(),margin+((1-y)*height).toFloat())
            }
            drawRect(colors.outline,Offset(margin,margin),Size(width,height),style=Stroke(1.dp.toPx()))
            if(chart.type in setOf("pie","doughnut")) {
                val values=points.map { abs(it.y) };val total=values.sum();var start=-90f
                if(total>0) values.forEachIndexed { index,value ->
                    val sweep=(value/total*360).toFloat()
                    drawArc(tone(null,index),start,sweep,chart.type=="pie",Offset(margin,margin),Size(width,height),style=if(chart.type=="doughnut") Stroke(28.dp.toPx()) else androidx.compose.ui.graphics.drawscope.Fill)
                    start+=sweep
                }
            } else {
                chart.annotations.orEmpty().forEach { annotation ->
                    val center=at(ToolPoint(annotation.x,annotation.y))
                    when(annotation.kind) {
                        "quadrants" -> annotation.labels?.let { labels ->
                            val texts=listOf(labels.topLeft,labels.topRight,labels.bottomLeft,labels.bottomRight)
                            val centers=listOf(Offset((margin+center.x)/2,(margin+center.y)/2),Offset((margin+width+center.x)/2,(margin+center.y)/2),Offset((margin+center.x)/2,(margin+height+center.y)/2),Offset((margin+width+center.x)/2,(margin+height+center.y)/2))
                            texts.forEachIndexed { index,text -> val layout=textMeasurer.measure(text,annotationStyle);drawText(layout,topLeft=centers[index]-Offset(layout.size.width/2f,layout.size.height/2f)) }
                        }
                        "rings" -> annotation.radiusPercent.orEmpty().forEach { radius -> drawCircle(colors.outline,(minOf(width,height)*radius/100).toFloat(),center,style=Stroke(1.dp.toPx(),pathEffect=PathEffect.dashPathEffect(floatArrayOf(2.dp.toPx(),5.dp.toPx())))) }
                    }
                }
                clipRect(margin,margin,margin+width,margin+height) {
                rows.forEachIndexed { index,data ->
                    val dataset=chart.datasets[index];val color=tone(dataset.tone,index)
                    val positions=data.map(::at)
                    if(chart.type=="bar") {
                        val barWidth=width/maxOf(1,data.size)/maxOf(1,rows.size)*.7f
                        positions.forEach { position -> val zero=at(ToolPoint(0.0,0.0)).y.coerceIn(margin,margin+height);drawRect(color,Offset(position.x-barWidth/2,minOf(position.y,zero)),Size(barWidth,abs(zero-position.y))) }
                    } else {
                        if(dataset.render!="point") positions.zipWithNext().forEach { (a,b) -> drawLine(color,a,b,2.dp.toPx()) }
                        if(dataset.render=="point") positions.forEach { drawCircle(color,6.dp.toPx(),it) }
                    }
                }
                }
            }
        }
        chart.xAxis?.let { Text("${it.label}: ${it.minimumLabel ?: jsNumberToString(xMin)} — ${it.maximumLabel ?: jsNumberToString(xMax)}",color=colors.onSurfaceVariant) }
        chart.datasets.forEachIndexed { index,dataset -> Text(dataset.label,color=tone(dataset.tone,index),style=MaterialTheme.typography.labelMedium) }
        chart.annotations.orEmpty().forEach { annotation ->
            annotation.labels?.let { Text("${it.topLeft} · ${it.topRight} · ${it.bottomLeft} · ${it.bottomRight}",color=colors.onSurfaceVariant) }
            if(!annotation.radiusPercent.isNullOrEmpty()) Text("${annotation.kind}: ${annotation.radiusPercent.joinToString { jsNumberToString(it)+"%" }}",color=colors.onSurfaceVariant)
        }
        chart.caption?.let { Text(it,color=colors.onSurfaceVariant) }
        NativePaperButton(if(showData) "Скрыть данные графика" else "Данные графика",{showData=!showData},glyph=if(showData) NativeAppGlyphName.CaretUp else NativeAppGlyphName.CaretDown)
        if(showData) {
            val all=rows.flatMapIndexed { datasetIndex,data -> data.mapIndexed { index,p -> Triple(chart.datasets[datasetIndex].label,chart.labels.getOrNull(index),p) } }
            Text("Точки ${dataPage*32+1}–${minOf(all.size,(dataPage+1)*32)} из ${all.size}")
            all.drop(dataPage*32).take(32).forEach { (name,label,point) -> Text("$name · ${label ?: jsNumberToString(point.x)}: ${jsNumberToString(point.y)}",style=MaterialTheme.typography.bodySmall) }
            Row { NativePaperIconButton(NativeAppGlyphName.CaretLeft,{dataPage-=1},"Предыдущие данные",enabled=dataPage>0);NativePaperIconButton(NativeAppGlyphName.CaretRight,{dataPage+=1},"Следующие данные",enabled=(dataPage+1)*32<all.size) }
        }
    }
}
