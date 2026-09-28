package dev.localmed.nativespike.shared.golden

/**
 * NOT VERIFIED on wasmJs. See GoldenFixture.kt's `readFileAtPath` doc for why (no synchronous file
 * loading mechanism set up in this spike's Karma test harness). wasmJs also has no real SQLite
 * (see `NativeSearchDatabase.wasmJs.kt`), so a golden-parity check would be measuring the stub's
 * fixed sample data against real production output regardless — not meaningful here even if the
 * loading mechanics were solved. `readTestEnvironmentValue` returns `null` (honest "not supplied"),
 * and `readFileAtPath` throws instead of silently returning empty/fake data.
 */
actual fun readTestEnvironmentValue(name: String): String? = null

actual fun readFileAtPath(path: String): String {
    error(
        "readFileAtPath() is not implemented for wasmJs — see GoldenFixture.kt's header for why. " +
            "Golden-parity tests must skip themselves on this target, not treat this as a pass.",
    )
}
