package dev.localmed.nativespike.shared

import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.window.ComposeViewport
import dev.localmed.nativespike.shared.preview.NativeVisualPreview
import kotlinx.browser.document

/** Development fixture viewer; production retrieval uses the supported native adapters. */
@OptIn(ExperimentalComposeUiApi::class)
fun main() {
    ComposeViewport(requireNotNull(document.getElementById("native-preview-root"))) { NativeVisualPreview() }
}
