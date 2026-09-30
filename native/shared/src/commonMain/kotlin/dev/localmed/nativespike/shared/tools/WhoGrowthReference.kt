package dev.localmed.nativespike.shared.tools

import dev.localmed.nativespike.shared.text.jsMathRound
import dev.localmed.nativespike.shared.text.jsNumberToString
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.sqrt
import kotlin.math.truncate

internal class WhoGrowthReference(private val tables: Map<String, WhoTable>) {
    private data class Lms(val l: Double, val m: Double, val s: Double)
    private val decoded = mutableMapOf<String, DoubleArray>()
    private fun table(id: String) = tables[id] ?: throw ToolExpressionError("Неизвестная таблица нормативов роста ВОЗ «$id».")
    private fun decode(table: WhoTable): DoubleArray {
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; val bytes = mutableListOf<Int>(); var accumulator = 0; var bits = 0
        for(c in table.encoded) { if(c == '=') break; val digit = alphabet.indexOf(c); if(digit < 0) throw ToolExpressionError("Данные LMS ВОЗ содержат недопустимый символ base64."); accumulator = accumulator * 64 + digit; bits += 6; if(bits >= 8) { bits -= 8; bytes += (accumulator shr bits) and 255; accumulator = accumulator and ((1 shl bits) - 1) } }
        val result = DoubleArray((table.end - table.start + 1) * 2 * 3); var byteOffset = 0; var previous = 0L
        for(index in result.indices) { var encoded = 0L; var shift = 0
            while(true) { val byte = bytes.getOrNull(byteOffset++) ?: throw ToolExpressionError("Данные LMS ВОЗ закончились до декодирования всех строк."); encoded += (byte and 127).toLong() shl shift; if(byte and 128 == 0) break; shift += 7; if(shift > 49) throw ToolExpressionError("Данные LMS ВОЗ содержат слишком большое целое число.") }
            previous += if(encoded % 2 == 0L) encoded / 2 else -(encoded + 1) / 2
            result[index] = previous / 100_000.0
        }
        if(byteOffset != bytes.size) throw ToolExpressionError("Данные LMS ВОЗ содержат лишние байты.")
        return result
    }
    private fun parameters(id: String, table: WhoTable, sex: String, axisValue: Double): Lms {
        if(!axisValue.isFinite()) throw ToolExpressionError("Для стандартов роста ВОЗ требуется конечное значение возраста или размера.")
        val lower: Int; val upper: Int; val fraction: Double
        when(table.axis) {
            "age-days" -> { val day = jsMathRound(axisValue); if(abs(day - axisValue) > 1e-9) throw ToolExpressionError("Таблицы ВОЗ 0–5 требуют целый возраст в днях."); if(day < table.start || day > table.end) throw ToolExpressionError("Таблица ВОЗ доступна для возраста от ${table.start} до ${table.end} дней."); lower = day.toInt(); upper = lower; fraction = 0.0 }
            "age-months" -> { if(axisValue < table.start || axisValue > table.end) throw ToolExpressionError("Таблица ВОЗ доступна для возраста от ${table.start} до ${table.end} месяцев."); lower = truncate(axisValue).toInt(); val raw = axisValue - lower; fraction = if(raw <= 1e-9 || lower == table.end) 0.0 else raw; upper = if(fraction == 0.0) lower else lower + 1 }
            else -> { val scaled = axisValue * 10; lower = truncate(scaled + 1e-9).toInt(); val raw = scaled - lower; if(lower < table.start || lower > table.end || (raw > 1e-9 && lower + 1 > table.end)) throw ToolExpressionError("Таблицы ВОЗ «масса к длине/росту» доступны для длины/роста от ${jsNumberToString(table.start / 10.0)} до ${jsNumberToString(table.end / 10.0)} см."); fraction = if(raw <= 1e-9) 0.0 else raw; upper = if(fraction == 0.0) lower else lower + 1 }
        }
        val data = decoded.getOrPut(id) { decode(table) }
        val sexIndex = when(sex) { "male" -> 0; "female" -> 1; else -> throw ToolExpressionError("Для стандартов роста ВОЗ требуется выбрать пол: мужской или женский.") }
        fun row(axis: Int): Lms { val index = (sexIndex * (table.end - table.start + 1) + axis - table.start) * 3; if(index < 0 || index + 2 >= data.size) throw ToolExpressionError("В таблице LMS ВОЗ отсутствует строка нормативов."); return Lms(data[index], data[index + 1], data[index + 2]) }
        val l = row(lower); if(fraction == 0.0) return l; val u = row(upper)
        return Lms(l.l + fraction * (u.l - l.l), l.m + fraction * (u.m - l.m), l.s + fraction * (u.s - l.s))
    }
    private fun value(p: Lms, z: Double): Double { if(p.l == 0.0) return p.m * exp(p.s * z); val base = 1 + p.l * p.s * z; return if(base <= 0) Double.NaN else p.m * toolPower(base, 1 / p.l) }
    private fun rawZ(p: Lms, measurement: Double) = if(p.l == 0.0) ln(measurement / p.m) / p.s else (toolPower(measurement / p.m, p.l) - 1) / (p.s * p.l)
    private fun adjustedZ(p: Lms, measurement: Double): Double {
        val z = rawZ(p, measurement); if(z <= 3 && z >= -3) return z
        val pos3 = value(p, 3.0); val neg3 = value(p, -3.0); val pos2 = value(p, 2.0); val neg2 = value(p, -2.0)
        if(!listOf(pos3, neg3, pos2, neg2).all(Double::isFinite)) throw ToolExpressionError("Параметры LMS ВОЗ не позволяют рассчитать скорректированный z-score.")
        return if(z > 3) 3 + (measurement - pos3) / (pos3 - pos2) else -3 + (measurement - neg3) / (neg2 - neg3)
    }
    fun zScore(id: String, sex: String, axis: Double, measurement: Double): Double {
        val t = table(id); if(!measurement.isFinite() || measurement <= 0) throw ToolExpressionError("Измерения для стандартов роста ВОЗ должны быть положительными числами.")
        val p = parameters(id, t, sex, axis); val z = if(t.adjusted) adjustedZ(p, measurement) else rawZ(p, measurement)
        if(!z.isFinite()) throw ToolExpressionError("Расчёт LMS ВОЗ вернул некорректный z-score."); return z
    }
    fun valueAtZ(id: String, sex: String, axis: Double, z: Double): Double {
        val t = table(id); if(!z.isFinite()) throw ToolExpressionError("Для кривой ВОЗ требуется корректный z-score.")
        val result = value(parameters(id, t, sex, axis), z); if(!result.isFinite() || result <= 0) throw ToolExpressionError("Параметры LMS ВОЗ не позволяют построить референсную кривую."); return result
    }
    fun percentile(z: Double): Double {
        if(!z.isFinite()) throw ToolExpressionError("Для перцентиля требуется корректный z-score.")
        val v = z / sqrt(2.0); val a = abs(v); val t = 1 / (1 + 0.3275911 * a)
        val polynomial = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a)
        return minOf(100.0, maxOf(0.0, 50 * (1 + (if(v < 0) -1 else 1) * polynomial)))
    }
    fun band(indicator: String, z: Double): String {
        if(!z.isFinite()) throw ToolExpressionError("Для интерпретации ВОЗ требуется корректный z-score.")
        return if(indicator == "bmi" || indicator == "weight-length") when {
            z < -3 -> "Ниже −3 SD: выраженная худоба/истощение по этому индикатору."
            z < -2 -> "От −3 до −2 SD: худоба/истощение по этому индикатору."
            z > 3 -> "Выше +3 SD: ожирение по BMI-for-age."
            z > 2 -> "Выше +2 SD: избыточная масса по BMI-for-age."
            z > 1 -> "Выше +1 SD: риск избыточной массы по BMI-for-age."
            else -> "От −2 до +1 SD: в диапазоне без отмеченного отклонения по этому индикатору."
        } else when { z < -3 -> "Ниже −3 SD: выраженное снижение относительно возрастной нормы."; z < -2 -> "От −3 до −2 SD: снижение относительно возрастной нормы."; z > 2 -> "Выше +2 SD: выше возрастного диапазона; нужна клиническая оценка."; else -> "От −2 до +2 SD: в диапазоне возрастной нормы по этому индикатору." }
    }
}
