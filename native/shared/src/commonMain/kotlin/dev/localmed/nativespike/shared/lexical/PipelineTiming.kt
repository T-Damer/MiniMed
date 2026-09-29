package dev.localmed.nativespike.shared.lexical

import kotlin.time.TimeSource

/**
 * Optimization-pass profiling instrumentation (docs/research/native-vs-webview-2026-09-28.md,
 * "Optimization pass" section). `onStage`, when non-null, receives `(stageName, milliseconds)` for
 * every timed block below; callers that call the same stage name more than once per query (e.g.
 * one SQL/hydration pair per branch) should SUM by name to get the query's total per-stage cost —
 * this is what the bench harness does. Zero overhead when `onStage` is null: the `TimeSource` calls
 * are skipped entirely, not just their callback.
 */
inline fun <T> timedStage(noinline onStage: ((String, Double) -> Unit)?, name: String, block: () -> T): T {
    if (onStage == null) return block()
    val started = TimeSource.Monotonic.markNow()
    val result = block()
    onStage(name, started.elapsedNow().inWholeMicroseconds / 1000.0)
    return result
}
