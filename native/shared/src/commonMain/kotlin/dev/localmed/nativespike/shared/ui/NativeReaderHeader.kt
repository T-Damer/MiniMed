package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** One control row; provenance and errors remain available without shrinking the source viewport. */
@Composable
fun NativeReaderHeader(
    title: String, details: List<String>, error: String?, onBack: () -> Unit,
    onSaveItem: (() -> Unit)? = null, onRetrySave: (() -> Unit)? = null,
) {
    var expanded by remember(title) { mutableStateOf(false) }
    // A new failure is announced visibly; hiding the controls never discards the retry action.
    LaunchedEffect(title, error) { if (error != null) expanded = true }
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        NativePaperIconButton(NativeAppGlyphName.ArrowLeft, onBack, "Назад", primary = true)
        Text(title, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis,
            style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
        Box {
            NativePaperIconButton(if (error == null) NativeAppGlyphName.DotsThreeVertical else NativeAppGlyphName.Info,
                onClick = { expanded = !expanded }, description = "Сведения и действия источника", modifier = Modifier.semantics {
                    if (error != null) stateDescription = "Ошибка чтения или сохранения"
                })
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false },
                modifier = Modifier.widthIn(min = 240.dp, max = 340.dp).heightIn(max = 420.dp)
                    .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(11.dp)),
                shape = RoundedCornerShape(11.dp), containerColor = MaterialTheme.colorScheme.surface) {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
                    details.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    error?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface) }
                }
                onRetrySave?.let { action -> DropdownMenuItem(text = { Text("Повторить сохранение") }, onClick = { expanded = false; action() }) }
                onSaveItem?.let { action ->
                    HorizontalDivider()
                    DropdownMenuItem(text = { Text("Сохранить источник") }, onClick = { expanded = false; action() })
                }
            }
        }
    }
}
