package dev.localmed.nativespike.shared.designsystem

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toAwtImage
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.designsystem.gallery.NativeDesignGallery
import java.io.File
import javax.imageio.ImageIO
import kotlin.test.Test

/**
 * Renders the design-system gallery at the web reference size (375 × 812 dp, density 1) in light,
 * dark and core-loading states into playwright/, for `bun run native:design compare`.
 */
@OptIn(ExperimentalTestApi::class)
class NativeDesignGalleryTest {
    @Test
    fun writeHomeGallery() {
        for ((dark, loading) in listOf(false to false, true to false, false to true)) {
            runComposeUiTest {
                setContent {
                    CompositionLocalProvider(LocalDensity provides Density(1f)) {
                        ProvideNativeDesignTokens(dark) {
                            Box(Modifier.size(375.dp, 812.dp)) { NativeDesignGallery(loading = loading, autoplay = false) }
                        }
                    }
                }
                val name = (if (dark) "dark" else "light") + if (loading) "-loading" else ""
                val image = onRoot().captureToImage().toAwtImage()
                val out = File(System.getProperty("user.dir"), "../../playwright/native-design-gallery-$name.png")
                out.parentFile.mkdirs()
                ImageIO.write(image, "png", out)
            }
        }
    }
}
