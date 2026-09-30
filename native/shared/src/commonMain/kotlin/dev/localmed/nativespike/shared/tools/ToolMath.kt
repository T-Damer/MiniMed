package dev.localmed.nativespike.shared.tools

import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.sqrt

/** Source runtime semantics: JavaScriptCore operationMathPow uses square-root halves and
 * multiplication for positive integral powers through 1000. This matters before display rounding.
 * Reference: WebKit Source/JavaScriptCore/runtime/MathCommon.cpp operationMathPow. */
internal fun toolPower(base: Double, exponent: Double): Double {
    if(exponent.isNaN() || (abs(base) == 1.0 && exponent.isInfinite())) return Double.NaN
    if(exponent == 0.5) return when { base == 0.0 -> 0.0; base.isInfinite() -> Double.POSITIVE_INFINITY; else -> sqrt(base) }
    if(exponent == -0.5) return when { base == 0.0 -> Double.POSITIVE_INFINITY; base.isInfinite() -> 0.0; else -> 1 / sqrt(base) }
    if(exponent >= 0 && exponent <= 1000 && exponent % 1.0 == 0.0) {
        var power = exponent.toInt(); var factor = base; var result = 1.0
        while(power > 0) { if(power and 1 == 1) result *= factor; factor *= factor; power = power ushr 1 }
        return result
    }
    return base.pow(exponent)
}
