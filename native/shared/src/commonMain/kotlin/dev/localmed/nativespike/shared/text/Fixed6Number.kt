package dev.localmed.nativespike.shared.text

/** Number(value.toFixed(6)).toString(), used by the clinical weight parser.
 * Exact binary digits avoid platform rounding/printing differences. Extreme subnormals need at
 * most 1074 small integer multiplications; this bounded work runs only for a parsed weight. */
internal fun fixed6NumberString(value: Double): String {
    require(value.isFinite()) { "Expected a finite parsed number" }
    if (value == 0.0) return "0"
    val negative = value < 0
    val magnitude = if (negative) -value else value
    val rounded = if (magnitude >= 1e21) magnitude else {
        val (digits, scale) = exactDecimal(magnitude)
        val aligned = digits.padStart(scale + 1, '0')
        val keep = aligned.length - scale + 6
        val prefix = aligned.take(keep).padEnd(keep, '0')
        val coefficient = if ((aligned.getOrNull(keep) ?: '0') >= '5') incrementDecimal(prefix) else prefix
        (coefficient.dropLast(6) + "." + coefficient.takeLast(6)).toDouble()
    }
    if (rounded == 0.0) return "0"
    return (if (negative) "-" else "") + shortestNumber(rounded)
}

/** coefficient * 10^-scale represents the actual IEEE value, not its printed approximation. */
private fun exactDecimal(value: Double): Pair<String, Int> {
    val bits = value.toBits()
    val exponent = ((bits ushr 52) and 0x7ff).toInt()
    val fraction = bits and 0x000fffffffffffffL
    val mantissa = if (exponent == 0) fraction else fraction or (1L shl 52)
    val power = if (exponent == 0) -1074 else exponent - 1023 - 52
    var digits = mantissa.toString()
    repeat(kotlin.math.abs(power)) { digits = multiplyDecimal(digits, if (power < 0) 5 else 2) }
    return digits to maxOf(0, -power)
}

private fun multiplyDecimal(digits: String, factor: Int): String {
    var carry = 0
    val result = StringBuilder(digits.length + 1)
    for (index in digits.indices.reversed()) {
        val product = (digits[index] - '0') * factor + carry
        result.append(('0'.code + product % 10).toChar())
        carry = product / 10
    }
    if (carry > 0) result.append(('0'.code + carry).toChar())
    return result.reverse().toString()
}

private fun incrementDecimal(digits: String): String {
    val result = digits.toCharArray()
    for (index in result.indices.reversed()) {
        if (result[index] != '9') { result[index]++; return result.concatToString() }
        result[index] = '0'
    }
    return "1" + result.concatToString()
}

private fun shortestNumber(value: Double): String {
    val (digits, scale) = exactDecimal(value)
    for (precision in 1..17) {
        val prefix = digits.take(precision).padEnd(precision, '0')
        val tail = digits.drop(precision)
        val aboveHalf = tail.firstOrNull()?.let { it > '5' || (it == '5' && tail.drop(1).any { c -> c != '0' }) } == true
        val tie = tail.firstOrNull() == '5' && tail.drop(1).all { it == '0' }
        val nearest = if (aboveHalf || (tie && (prefix.last() - '0') % 2 != 0)) incrementDecimal(prefix) else prefix
        val power = digits.length - scale - precision
        // Binary rounding intervals can be asymmetric at powers of two: also test the other side.
        for (candidate in listOf(nearest, prefix, incrementDecimal(prefix)).distinct()) {
            if ("${candidate}e$power".toDouble() == value) return numberNotation(candidate, power)
        }
    }
    error("Finite IEEE number has no 17-digit round trip")
}

private fun numberNotation(coefficient: String, power: Int): String {
    val digits = coefficient.trimEnd('0')
    val point = coefficient.length + power
    return when {
        digits.length <= point && point <= 21 -> digits.padEnd(point, '0')
        point > 0 && point <= 21 -> digits.take(point) + "." + digits.drop(point)
        point > -6 && point <= 0 -> "0." + "0".repeat(-point) + digits
        else -> digits.take(1) + (if (digits.length > 1) "." + digits.drop(1) else "") +
            "e" + (if (point - 1 >= 0) "+" else "") + (point - 1)
    }
}
