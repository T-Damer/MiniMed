package dev.localmed.nativespike.shared.ui

/**
 * Whether this platform can blur a recorded scene layer for the chrome glass. Android draws nested
 * graphics layers (RenderNode); the skiko targets (desktop, iOS, Wasm preview) record them empty,
 * so they get a translucent strip instead.
 */
internal expect val nativeBlurBackdrop: Boolean
