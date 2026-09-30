@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package dev.localmed.nativespike.shared.text

import platform.Foundation.NSString
import platform.Foundation.precomposedStringWithCompatibilityMapping

internal actual fun compatibilityNormalize(value: String): String =
    (value as NSString).precomposedStringWithCompatibilityMapping
