package dev.localmed.nativespike.shared.tools

import kotlin.math.abs
import kotlin.math.floor

internal class AapBloodPressureReference(private val tables: Map<String, List<BpRow>>) {
    private fun row(sex: String, age: Double): BpRow {
        if(sex != "female" && sex != "male") throw ToolExpressionError("AAP АД: укажите пол ребёнка.")
        val completed = floor(age); if(!age.isFinite() || completed < 1 || completed > 17) throw ToolExpressionError("AAP АД: возраст должен быть от 1 года до 17 лет включительно.")
        return tables[sex]?.getOrNull(completed.toInt() - 1) ?: throw ToolExpressionError("AAP АД: для этого возраста нет табличной строки.")
    }
    private fun heightIndex(row: BpRow, height: Double): Int {
        if(!height.isFinite() || height <= 0) throw ToolExpressionError("AAP АД: укажите рост ребёнка.")
        var nearest = 0; val heights = row.columns[0]
        for(index in 1 until heights.size) if(abs(heights[index] - height) < abs(heights[nearest] - height)) nearest = index
        return nearest
    }
    fun heightPercentile(sex: String, age: Double, height: Double): Double = listOf(5.0, 10.0, 25.0, 50.0, 75.0, 90.0, 95.0)[heightIndex(row(sex, age), height)]
    fun threshold(sex: String, age: Double, height: Double, kind: String, percentile: Double): Double {
        if(kind != "systolic" && kind != "diastolic") throw ToolExpressionError("AAP АД: неизвестный тип давления.")
        if(percentile !in listOf(50.0, 90.0, 95.0)) throw ToolExpressionError("AAP АД: поддерживаются только 50-й, 90-й и 95-й перцентили.")
        val row = row(sex, age); val index = when(percentile) { 50.0 -> 1; 90.0 -> 3; else -> 5 } + if(kind == "systolic") 0 else 1
        return row.columns[index][heightIndex(row, height)]
    }
    fun category(sex: String, age: Double, height: Double, systolic: Double, diastolic: Double): String {
        if(!listOf(systolic, diastolic).all { it.isFinite() && it > 0 }) throw ToolExpressionError("AAP АД: укажите систолическое и диастолическое давление.")
        if(age >= 13) return when { systolic >= 140 || diastolic >= 90 -> "stage2"; systolic >= 130 || diastolic >= 80 -> "stage1"; systolic >= 120 && diastolic < 80 -> "elevated"; else -> "normal" }
        val sbp90 = threshold(sex, age, height, "systolic", 90.0); val sbp95 = threshold(sex, age, height, "systolic", 95.0)
        val dbp90 = threshold(sex, age, height, "diastolic", 90.0); val dbp95 = threshold(sex, age, height, "diastolic", 95.0)
        return when { systolic >= minOf(sbp95 + 12, 140.0) || diastolic >= minOf(dbp95 + 12, 90.0) -> "stage2"; systolic >= minOf(sbp95, 130.0) || diastolic >= minOf(dbp95, 80.0) -> "stage1"; systolic >= minOf(sbp90, 120.0) || diastolic >= minOf(dbp90, 80.0) -> "elevated"; else -> "normal" }
    }
    fun categoryLabel(category: String) = when(category) { "normal" -> "Нормальное артериальное давление"; "elevated" -> "Повышенное артериальное давление"; "stage1" -> "Артериальная гипертензия 1-й степени"; "stage2" -> "Артериальная гипертензия 2-й степени"; else -> throw ToolExpressionError("AAP АД: неизвестная категория.") }
}
