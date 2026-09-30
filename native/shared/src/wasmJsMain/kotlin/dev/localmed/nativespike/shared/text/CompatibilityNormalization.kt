package dev.localmed.nativespike.shared.text

@JsFun("(value) => value.normalize('NFKC')")
private external fun normalizeNfkc(value: String): String

internal actual fun compatibilityNormalize(value: String): String = normalizeNfkc(value)
