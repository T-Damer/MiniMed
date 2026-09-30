package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.core.NativeCoreIdentityHit
import dev.localmed.nativespike.shared.core.NativeCoreIdentityTarget
import kotlinx.coroutines.launch

/** Separate from lexical rows so existing durable result indices keep their meaning. */
@Composable
fun NativeIdentityRail(hits: List<NativeCoreIdentityHit>, opening: Boolean, onOpen: (NativeCoreIdentityHit) -> Unit) {
    if (hits.isEmpty()) return
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Точных названий: ${hits.size}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onBackground)
            Text("${listState.firstVisibleItemIndex + 1} / ${hits.size}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onBackground)
        }
        LazyRow(state = listState, contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(hits) { hit ->
                Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.width(280.dp).heightIn(max = 220.dp)) {
                    Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(hit.title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
                        if (hit.name != hit.title) Text("Название в источнике: ${hit.name}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(nativeIdentityCoverageLabel(hit.coverage), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        when (val target = hit.target) {
                            is NativeCoreIdentityTarget.Document -> Text("Набор: ${target.moduleId}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            is NativeCoreIdentityTarget.Definition -> {
                                Text("Требует проверки · запись в пределах источника", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("Запись: ${target.entityId}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        TextButton(onClick = { onOpen(hit) }, enabled = !opening) { Text("Открыть запись") }
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(enabled = listState.firstVisibleItemIndex > 0, onClick = {
                scope.launch { listState.animateScrollToItem((listState.firstVisibleItemIndex - 1).coerceAtLeast(0)) }
            }) { Text("Предыдущее") }
            TextButton(enabled = listState.firstVisibleItemIndex < hits.lastIndex, onClick = {
                scope.launch { listState.animateScrollToItem((listState.firstVisibleItemIndex + 1).coerceAtMost(hits.lastIndex)) }
            }) { Text("Следующее") }
        }
    }
}
