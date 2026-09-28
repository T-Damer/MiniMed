package dev.localmed.nativespike.shared.text

import kotlin.math.abs
import kotlin.math.round

/**
 * `"%.1f".format(x)`-equivalent, portable across every target this module builds for. Kotlin's
 * `String.format`/`kotlin.text.format` is JVM-only (backed by `java.util.Formatter`) — it does not
 * exist for Kotlin/Native (iOS) or Kotlin/Wasm, both added alongside Android/desktop in this
 * module (see ADR 0021's "Multiplatform build and tests"). Assumes a non-negative value, which
 * every caller here satisfies (elapsed milliseconds).
 */
fun formatFixed1(value: Double): String {
    val scaledTenths = round(value * 10).toLong()
    val whole = scaledTenths / 10
    val tenths = abs(scaledTenths % 10)
    return "$whole.$tenths"
}
