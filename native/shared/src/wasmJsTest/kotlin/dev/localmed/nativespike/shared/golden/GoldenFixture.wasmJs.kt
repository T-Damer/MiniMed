package dev.localmed.nativespike.shared.golden

/**
 * NOT VERIFIED on wasmJs. Loading `search-golden.json` into a Karma-run browser test needs either
 * an async `fetch()` (awkward from this `expect fun`'s synchronous signature — would need reshaping
 * the whole golden-parity test API to suspend, or a Kotlin/Wasm-specific top-level await trick) or
 * a webpack copy-plugin step to place the file where a synchronous `XMLHttpRequest` could reach it
 * — neither was set up for this spike. wasmJs also has no real SQLite (see
 * `NativeSearchDatabase.wasmJs.kt`), so a golden-parity check would be measuring the stub's fixed
 * sample data against real production output regardless — not meaningful here even if the loading
 * mechanics were solved. Throws instead of silently returning empty/fake data.
 */
actual fun readGoldenFixture(): String {
    error(
        "readGoldenFixture() is not implemented for wasmJs — see this file's header for why. " +
            "Golden-parity tests must skip themselves on this target, not treat this as a pass.",
    )
}
