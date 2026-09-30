package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.font.FontWeight
import dev.localmed.nativespike.shared.core.NativeDefinitionBlock
import dev.localmed.nativespike.shared.core.NativeDefinitionCard

@Composable
fun NativeDefinitionBlockSelector(
    state: NativeDefinitionReaderState, card: NativeDefinitionCard,
    onSelect: (NativeDefinitionBlock) -> Unit, onMore: () -> Unit,
    onPrevious: () -> Unit, onNext: () -> Unit,
) {
    val selectedIndex = state.blocks.indexOfFirst { it.linkId == state.selected?.linkId }
    val listState = remember(state) { LazyListState() }
    LaunchedEffect(state, selectedIndex) {
        if (selectedIndex >= 0) listState.animateScrollToItem(selectedIndex)
    }
    Column(Modifier.fillMaxWidth()) {
        Text("Исходный блок: ${if (selectedIndex < 0) 0 else selectedIndex + 1} из ${card.blockCount}",
            modifier = Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        LazyRow(state = listState, contentPadding = PaddingValues(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            itemsIndexed(state.blocks, key = { _, block -> block.linkId }) { index, block ->
                val isSelected = state.selected?.linkId == block.linkId
                TextButton(modifier = Modifier.semantics { selected = isSelected }, onClick = { onSelect(block) }) {
                    Column {
                        Text("${index + 1}. ${nativeDefinitionBlockLabel(block.role, card)}", fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal)
                        Text("Символов: ${block.characters}", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth()) {
            TextButton(modifier = Modifier.weight(1f), enabled = selectedIndex > 0 && !state.blocksLoading, onClick = onPrevious) { Text("Предыдущий блок") }
            TextButton(modifier = Modifier.weight(1f), enabled = selectedIndex >= 0 && !state.blocksLoading &&
                (selectedIndex + 1 < state.blocks.size || state.nextBlocks != null), onClick = onNext) { Text("Следующий блок") }
        }
        if (state.blocksLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
        else if (state.nextBlocks != null) TextButton(onClick = onMore) { Text("Ещё исходные блоки") }
    }
}
