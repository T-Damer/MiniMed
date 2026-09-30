package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.tools.NativeToolCatalogMatch
import dev.localmed.nativespike.shared.tools.NativeToolKind
import dev.localmed.nativespike.shared.tools.NativeToolRecord
import dev.localmed.nativespike.shared.user.NativeItemRef
import kotlinx.coroutines.launch

/** Independent name/catalog matches: no document score, corpus rank or clinical promotion. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NativeToolMatchesRail(query: String,matches: List<NativeToolCatalogMatch>,onOpenTool: (NativeToolRecord) -> Unit,
    onSaveItem: (NativeItemRef) -> Unit,onOpenCatalog: () -> Unit) {
    if(matches.isEmpty()) return
    val state=remember(query,matches.map { it.tool.id }) { LazyListState() }
    val scope=rememberCoroutineScope()
    val current=state.firstVisibleItemIndex.coerceIn(matches.indices)
    Column(verticalArrangement=Arrangement.spacedBy(6.dp)) {
        Text("Инструменты по названию · ${matches.size}",style=MaterialTheme.typography.titleMedium,color=MaterialTheme.colorScheme.onSurface)
        FlowRow(horizontalArrangement=Arrangement.spacedBy(6.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
            NativePaperIconButton(NativeAppGlyphName.CaretLeft,{scope.launch { state.animateScrollToItem(current-1) }},"Предыдущий инструмент",enabled=current>0)
            Text("${current+1} / ${matches.size}",Modifier.padding(top=12.dp),color=MaterialTheme.colorScheme.onSurface)
            NativePaperIconButton(NativeAppGlyphName.CaretRight,{scope.launch { state.animateScrollToItem(current+1) }},"Следующий инструмент",enabled=current<matches.lastIndex)
            NativePaperButton("Все инструменты",onOpenCatalog,glyph=NativeAppGlyphName.Calculator)
        }
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val width=minOf(320.dp,maxWidth-32.dp).coerceAtLeast(180.dp)
            val end=maxOf(16.dp,maxWidth-width-16.dp)
            LazyRow(state=state,contentPadding=PaddingValues(start=16.dp,end=end),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                items(matches,key={it.tool.id}) { match ->
                    val record=match.tool
                    NativePaperSurface(Modifier.width(width).height(280.dp).clickable { onOpenTool(record) }) {
                        Column(Modifier.fillMaxSize().padding(12.dp)) {
                            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                                Text(record.title,style=MaterialTheme.typography.titleMedium)
                                Text(if(match.kind==NativeToolKind.Calculator) "Калькулятор" else "Шкала / опросник",style=MaterialTheme.typography.labelMedium)
                                Text(record.description,color=MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("${record.bankLabel} · ${record.version}",style=MaterialTheme.typography.labelSmall)
                            }
                            Row {
                                NativePaperButton("Открыть",{onOpenTool(record)},primary=true)
                                NativePaperIconButton(NativeAppGlyphName.Bookmark,{onSaveItem(nativeToolItem(record))},"Сохранить ${record.title}",Modifier.padding(start=8.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}
