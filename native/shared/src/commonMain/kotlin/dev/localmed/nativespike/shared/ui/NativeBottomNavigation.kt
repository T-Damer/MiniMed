package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.designsystem.NativeBottomNav
import dev.localmed.nativespike.shared.designsystem.NativeNavItem
import dev.localmed.nativespike.shared.designsystem.NativeDimensions

internal val LocalNativeNavigationPadding = compositionLocalOf { 0.dp }

/** WebView AppBottomNav: floating dark tray, paper selection and the original three glyphs. */
@Composable
internal fun NativeBottomNavigation(selectedIndex: Int, onSearch: () -> Unit, onCollections: () -> Unit, onSettings: () -> Unit) {
        val items = listOf(
            Triple(NativeAppGlyphName.Search, "Поиск", onSearch),
            Triple(NativeAppGlyphName.FolderOpen, "Избранное и коллекции", onCollections),
            Triple(NativeAppGlyphName.System, "Настройки", onSettings),
        )
    NativeBottomNav(items.map { (glyph, description, _) -> NativeNavItem(description) { tint ->
        NativeAppGlyph(glyph, Modifier.size(NativeDimensions.space5), tint)
    } }, selectedIndex, { items[it].third() })
}
