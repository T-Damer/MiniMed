package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

internal val LocalNativeNavigationPadding = compositionLocalOf { 0.dp }

/** WebView AppBottomNav: floating dark tray, paper selection and the original three glyphs. */
@Composable
internal fun NativeBottomNavigation(selectedIndex: Int, onSearch: () -> Unit, onCollections: () -> Unit, onSettings: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Row(Modifier.shadow(16.dp, CircleShape).background(NativeNavigationSurface, CircleShape)
        .border(1.dp, colors.primary, CircleShape).padding(5.dp), horizontalArrangement = Arrangement.spacedBy(0.dp)) {
        val items = listOf(
            Triple(NativeAppGlyphName.Search, "Поиск", onSearch),
            Triple(NativeAppGlyphName.FolderOpen, "Избранное и коллекции", onCollections),
            Triple(NativeAppGlyphName.System, "Настройки", onSettings),
        )
        items.forEachIndexed { index, (glyph, description, action) ->
            val active = index == selectedIndex
            Box(Modifier.size(48.dp).semantics { contentDescription = description; selected = active }
                .clickable(role = Role.Tab, onClick = action), contentAlignment = Alignment.Center) {
                Box(Modifier.size(42.dp).then(if (active) Modifier.shadow(4.dp, CircleShape)
                    .background(Brush.linearGradient(listOf(lerp(colors.surfaceVariant, Color.White, .12f), colors.surfaceVariant)), CircleShape)
                    .border(1.dp, lerp(colors.primary, Color.White, .28f), CircleShape) else Modifier), contentAlignment = Alignment.Center) {
                    NativeAppGlyph(glyph, Modifier.size(20.dp), if (active) colors.primary else NativeNavigationInk)
                }
            }
        }
    }
}
