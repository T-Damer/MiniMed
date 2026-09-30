package dev.localmed.nativespike.shared.designsystem

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Renders the design-system components at the web reference width and compares their boxes with
 * the WebView's (web-component-reference.json). Colours, radii, borders and shadows are generated
 * from the same file, so this check covers what generation cannot: how components compose their
 * padding, fixed sizes and content into a box.
 */
@OptIn(ExperimentalTestApi::class)
class NativeComponentParityTest {
    private val reference: JsonObject = Json.parseToJsonElement(
        File(System.getProperty("TEST_RESOURCE_DIR"), "web-component-reference.json").readText(),
    ).jsonObject

    /** Box of [block] captured on the light theme, searched across the captured screens. */
    private fun webBox(block: String): Pair<Double, Double> {
        val screens = reference.getValue("themes").jsonObject.getValue("light").jsonObject
        val captured = screens.values.firstNotNullOf { it.jsonObject[block]?.jsonObject }
        val box = captured.getValue("box").jsonObject
        return box.getValue("width").jsonPrimitive.double to box.getValue("height").jsonPrimitive.double
    }

    private fun icon(): @Composable (androidx.compose.ui.graphics.Color) -> Unit = { Box(Modifier.size(18.dp)) }

    @Test
    fun componentsMatchTheWebBoxes() = runComposeUiTest {
        setContent {
            ProvideNativeDesignTokens(dark = false) {
                Column(Modifier.width(355.dp)) {
                    val components = NativeDesign.components
                    NativeIconButton(components.routeIconButton, "route-icon-button", "Случайная запись", {}, icon = icon())
                    NativeIconButton(components.searchButton, "search-button", "Найти", {}, icon = icon())
                    NativeIconButton(components.queryClear, "query-clear", "Очистить запрос", {}, icon = icon())
                    NativeIconButton(components.helpIconLink, "help-icon-link", "Как это работает", {}, icon = icon())
                    NativeIconButton(components.carouselArrow, "carousel-arrow", "Следующая", {}, icon = icon())
                    NativeClinicalToggle(false, {}, "Клинический разбор", icon = { _, _ -> Box(Modifier.size(20.dp)) })
                    NativeActionButton("Сфотографировать", {}, primary = true)
                    NativeActionButton("Из галереи", {}, primary = false)
                    NativeSectionList("Разделы") {
                        NativeSectionRow("МКБ, симптомы и состояния", "считаем…", first = true, onClick = {}, icon = icon())
                        NativeSectionRow("Клинические рекомендации", "считаем…", first = false, onClick = {}, icon = icon())
                    }
                    NativeCarouselDots(4, 0, {}, { "Функция ${it + 1} из 4" })
                    NativeBottomNav(
                        items = listOf(
                            NativeNavItem("Поиск", icon()),
                            NativeNavItem("Мои файлы", icon()),
                            NativeNavItem("Настройки", icon()),
                        ),
                        selected = 0,
                        onSelect = {},
                    )
                }
            }
        }
        val checks = listOf(
            // block, compare width?, compare height?
            Triple("route-icon-button", true, true),
            Triple("search-button", true, true),
            Triple("query-clear", true, true),
            Triple("help-icon-link", true, true),
            Triple("carousel-arrow", true, true),
            Triple("clinical-toggle", true, true),
            Triple("feature-action-primary", false, true),
            Triple("feature-action-secondary", false, true),
            Triple("section-row", false, true),
            Triple("section-icon-frame", true, true),
            Triple("carousel-dot-active", true, true),
            Triple("carousel-dot", true, true),
            Triple("bottom-nav-button-active", true, true),
            Triple("bottom-nav", true, true),
            Triple("bottom-nav-bubble", true, true),
        )
        val mismatches = checks.mapNotNull { (block, width, height) ->
            val node = onAllNodesWithTag(block, useUnmergedTree = true).fetchSemanticsNodes().firstOrNull()
                ?: return@mapNotNull "$block: not rendered"
            val native = with(density) { node.size.width.toDp().value to node.size.height.toDp().value }
            val web = webBox(block)
            val widthOff = width && abs(native.first - web.first) > TOLERANCE_DP
            val heightOff = height && abs(native.second - web.second) > TOLERANCE_DP
            if (widthOff || heightOff) {
                "$block: native ${native.first}×${native.second} vs web ${web.first}×${web.second}"
            } else {
                null
            }
        }
        assertTrue(mismatches.isEmpty(), mismatches.joinToString("\n"))
    }

    private companion object {
        const val TOLERANCE_DP = 1.0
    }
}
