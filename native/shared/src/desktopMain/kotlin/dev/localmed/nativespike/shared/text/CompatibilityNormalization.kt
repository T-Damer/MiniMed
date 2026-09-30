package dev.localmed.nativespike.shared.text

import java.text.Normalizer

internal actual fun compatibilityNormalize(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFKC)
