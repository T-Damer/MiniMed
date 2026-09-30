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
import androidx.compose.ui.test.runDesktopComposeUiTest
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.designsystem.gallery.NativeDesignGallery
import dev.localmed.nativespike.shared.designsystem.gallery.NativeReaderGallery
import dev.localmed.nativespike.shared.designsystem.gallery.NativeLibraryGallery
import dev.localmed.nativespike.shared.designsystem.gallery.NativeSettingsGallery
import androidx.compose.foundation.background
import java.io.File
import javax.imageio.ImageIO
import kotlin.test.Test

/**
 * Renders the design-system gallery at the web reference size (375 × 812 dp, density 1) in light,
 * dark, core-loading and results states into playwright/, for `bun run native:design compare`.
 */
@OptIn(ExperimentalTestApi::class)
class NativeDesignGalleryTest {
    @Test
    fun writeHomeGallery() {
        for ((variant, dark, loading) in VARIANTS) {
            // Results render taller, to review every card without scrolling.
            val height = if (variant.endsWith("results")) 1500 else 812
            runDesktopComposeUiTest(width = 375, height = height) {
                setContent {
                    CompositionLocalProvider(LocalDensity provides Density(1f)) {
                        ProvideNativeDesignTokens(dark) {
                            Box(Modifier.size(375.dp, height.dp)) { NativeDesignGallery(loading = loading, autoplay = false, initialQuery = if (variant.endsWith("results")) "пневмония" else "") }
                        }
                    }
                }
                val image = onRoot().captureToImage().toAwtImage()
                val out = File(System.getProperty("user.dir"), "../../playwright/native-design-gallery-$variant.png")
                out.parentFile.mkdirs()
                ImageIO.write(image, "png", out)
            }
        }
    }

    @Test
    fun writeReaderGallery() {
        for ((variant, dark, find) in listOf(Triple("light", false, ""), Triple("dark", true, ""), Triple("light-find", false, "строк"))) {
            runDesktopComposeUiTest(width = 375, height = 1400) {
                setContent {
                    CompositionLocalProvider(LocalDensity provides Density(1f)) {
                        ProvideNativeDesignTokens(dark) {
                            Box(Modifier.size(375.dp, 1400.dp)) { NativeReaderGallery(initialFind = find) }
                        }
                    }
                }
                val image = onRoot().captureToImage().toAwtImage()
                val out = File(System.getProperty("user.dir"), "../../playwright/native-reader-gallery-$variant.png")
                out.parentFile.mkdirs()
                ImageIO.write(image, "png", out)
            }
        }
    }

    @Test
    fun writePagesGallery() {
        val pages = listOf<Triple<String, Int, @androidx.compose.runtime.Composable () -> Unit>>(
            Triple("settings", 2460, { NativeSettingsGallery() }),
            Triple("files", 960, { NativeLibraryGallery() }),
        )
        for ((page, height, content) in pages) for (dark in listOf(false, true)) {
            runDesktopComposeUiTest(width = 375, height = height) {
                setContent {
                    CompositionLocalProvider(LocalDensity provides Density(1f)) {
                        ProvideNativeDesignTokens(dark) {
                            Box(Modifier.size(375.dp, height.dp).background(if (dark) DarkColorTokens.folder else LightColorTokens.folderLight)) { content() }
                        }
                    }
                }
                val image = onRoot().captureToImage().toAwtImage()
                val out = File(System.getProperty("user.dir"), "../../playwright/native-page-$page-${if (dark) "dark" else "light"}.png")
                out.parentFile.mkdirs()
                ImageIO.write(image, "png", out)
            }
        }
    }

    private companion object {
        val VARIANTS = listOf(
            Triple("light", false, false),
            Triple("dark", true, false),
            Triple("light-loading", false, true),
            Triple("light-results", false, false),
            Triple("dark-results", true, false),
        )
    }
}
