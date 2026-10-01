package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import dev.localmed.nativespike.shared.designsystem.NativeChip
import dev.localmed.nativespike.shared.designsystem.NativeDesign
import dev.localmed.nativespike.shared.designsystem.NativeDimensions
import dev.localmed.nativespike.shared.designsystem.NativeFeatureCarousel
import dev.localmed.nativespike.shared.designsystem.NativeFeature
import dev.localmed.nativespike.shared.designsystem.NativeCardAction
import dev.localmed.nativespike.shared.designsystem.NativeSectionList
import dev.localmed.nativespike.shared.designsystem.NativeSectionRow
import dev.localmed.nativespike.shared.designsystem.textStyle
import dev.localmed.nativespike.shared.tools.NativeToolCore
import dev.localmed.nativespike.shared.model.NativeSearchScope
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics

/** Real prepared Web copy; unported feature actions remain unavailable. */
@Composable
internal fun NativeSearchHomeContent(
    data: NativeHomeData,
    tools: NativeToolCore?,
    onOpenTools: (() -> Unit)?,
    onOpenSection: (NativeHomeSection) -> Unit,
    onExample: (String) -> Unit,
    scope: NativeSearchScope,
    showIntro: Boolean,
    experimentalFeatures: Boolean = false,
) {
    val components = NativeDesign.components
    val cards = remember(data, experimentalFeatures) { data.features.filter { experimentalFeatures || it.webVisibility == "always" } }
    var unavailableFeature by remember { mutableStateOf<String?>(null) }
    val features = cards.map { card ->
        fun action(value: NativeHomeAction) = NativeCardAction(value.label,
            { unavailableFeature = "Функция «${card.title}» пока недоступна в нативной версии." },
            value.icon?.let { glyph -> { tint -> NativeAppGlyph(nativeHomeGlyph(glyph), Modifier.size(NativeDimensions.space4), tint) } })
        NativeFeature(card.kicker, card.title, card.text, action(card.actions.first()), card.actions.getOrNull(1)?.let(::action),
            kickerIcon = { tint -> NativeAppGlyph(nativeHomeGlyph(card.icon), Modifier.size(NativeDimensions.space4), tint) })
    }
    // The intro keeps the same 16 dp rhythm from the query sheet as between its own blocks.
    Column(Modifier.fillMaxWidth().padding(top = NativeDimensions.space4).testTag("search-home-intro"), verticalArrangement = Arrangement.spacedBy(NativeDimensions.space4)) {
        if (showIntro) {
        onOpenTools?.let { open -> NativeChip("Все инструменты", open) { tint ->
            NativeAppGlyph(NativeAppGlyphName.SquaresFour, Modifier.size(NativeDimensions.space4), tint)
        } }
        NativeFeatureCarousel(features,
            positionLabel = { position, count -> "${data.carousel.itemLabel} ${position + 1} из $count" },
            previousLabel = "Предыдущая функция", nextLabel = "Следующая функция",
            autoplayMillis = data.carousel.autoplayMs,
            arrowIcon = { tint, next -> NativeAppGlyph(if (next) NativeAppGlyphName.CaretRight else NativeAppGlyphName.CaretLeft, Modifier.size(NativeDimensions.space4), tint) })
        unavailableFeature?.let { BasicText(it, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, style = components.featureText.text.textStyle()) }
        }
        val examples = data.examplesByScope[scope.name.lowercase()].orEmpty()
        if (showIntro && examples.isNotEmpty()) {
        Column(Modifier.testTag("query-examples")) {
            BasicText("ПРИМЕРЫ ПОИСКА", style = components.featureKicker.text.textStyle())
            LazyRow(horizontalArrangement = Arrangement.spacedBy(NativeDimensions.space2)) {
                itemsIndexed(examples) { position, example ->
                    NativeChip("${(position + 1).toString().padStart(2, '0')}  $example", { onExample(example) })
                }
            }
        }
        }
        if (scope == NativeSearchScope.ALL) {
        NativeSectionList("Разделы", Modifier.testTag("search-sections")) {
            data.sections.forEachIndexed { position, section ->
                NativeSectionRow(section.label, section.countLabel(tools), position == 0, { onOpenSection(section) },
                    icon = { tint -> NativeAppGlyph(nativeHomeGlyph(section.icon), Modifier.size(NativeDimensions.space5), tint) },
                    caret = { tint -> NativeAppGlyph(NativeAppGlyphName.CaretRight, Modifier.size(NativeDimensions.space4), tint) })
            }
        }
        }
    }
}

private fun nativeHomeGlyph(name: String): NativeAppGlyphName = NativeAppGlyphName.entries.first { it.webName == name }
