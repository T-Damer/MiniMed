package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Dimensions and tactile paper controls from WebView Button.css / TextField.css. */
@Composable
fun NativePaperSurface(modifier: Modifier = Modifier, raised: Boolean = true, content: @Composable () -> Unit) {
    val colors = MaterialTheme.colorScheme
    val shape = RoundedCornerShape(11.2.dp)
    Box(modifier.shadow(if (raised) 4.dp else 0.dp, shape, ambientColor = Color.Black.copy(alpha = .16f))
        .background(if (raised) colors.surfaceVariant else colors.surface, shape).border(1.dp, colors.outline, shape)) { content() }
}

@Composable
fun NativePaperButton(
    text: String, onClick: () -> Unit, modifier: Modifier = Modifier,
    primary: Boolean = false, enabled: Boolean = true, glyph: NativeAppGlyphName? = null,
) {
    val colors = MaterialTheme.colorScheme
    val ink = if (primary) colors.onPrimary else colors.onSurface
    val shape = RoundedCornerShape(10.4.dp)
    Row(modifier.heightIn(min = 42.dp).shadow(4.dp, shape)
        .background(if (primary) colors.primary else colors.surfaceVariant, shape)
        .border(1.dp, ink.copy(alpha = .25f), shape).alpha(if (enabled) 1f else .55f)
        .clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(horizontal = 14.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(7.dp), verticalAlignment = Alignment.CenterVertically) {
        glyph?.let { NativeAppGlyph(it, Modifier.size(18.dp), ink) }
        Text(text, color = ink, style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold))
    }
}

@Composable
fun NativePaperIconButton(
    glyph: NativeAppGlyphName, onClick: () -> Unit, description: String, modifier: Modifier = Modifier,
    primary: Boolean = false, enabled: Boolean = true,
) {
    val colors = MaterialTheme.colorScheme
    val ink = if (primary) colors.primary else colors.onSurface
    Box(modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp)
        .semantics { contentDescription = description }.alpha(if (enabled) 1f else .55f)
        .clickable(enabled = enabled, role = Role.Button, onClick = onClick), contentAlignment = Alignment.Center) {
        Box(Modifier.size(40.dp).shadow(3.dp, CircleShape).background(colors.surfaceVariant, CircleShape)
            .border(1.dp, ink.copy(alpha = .3f), CircleShape), contentAlignment = Alignment.Center) {
            NativeAppGlyph(glyph, Modifier.size(21.dp), ink)
        }
    }
}

@Composable
fun NativePaperTextField(
    value: String, onValueChange: (String) -> Unit, label: String, modifier: Modifier = Modifier,
    singleLine: Boolean = true, enabled: Boolean = true, keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
) {
    val colors = MaterialTheme.colorScheme
    val shape = RoundedCornerShape(8.8.dp)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (label.isNotEmpty()) Text(label, color = colors.onSurfaceVariant,
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold, fontSize = 12.5.sp))
        BasicTextField(value, onValueChange, enabled = enabled, singleLine = singleLine,
            maxLines = if (singleLine) 1 else 6, keyboardOptions = keyboardOptions,
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = colors.onSurface, lineHeight = 22.sp),
            cursorBrush = SolidColor(colors.primary),
            modifier = Modifier.fillMaxWidth().heightIn(min = 40.dp).background(colors.surfaceVariant, shape)
                .border(1.dp, colors.outline, shape).semantics { contentDescription = label },
            decorationBox = { inner -> Box(Modifier.padding(horizontal = 12.dp, vertical = 9.dp),
                contentAlignment = Alignment.CenterStart) { inner() } })
    }
}
