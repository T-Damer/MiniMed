package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.tools.*
import dev.localmed.nativespike.shared.user.NativeItemRef

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NativeToolsScreen(core: NativeToolCore,query: String,onQueryChange: (String) -> Unit,
    onOpenTool: (NativeToolRecord) -> Unit,onSaveItem: (NativeItemRef) -> Unit,onBack: () -> Unit) {
    var kind by remember { mutableStateOf<NativeToolKind?>(null) }
    val matches = remember(core,query,kind) { core.searchTools(query,kind) }
    NativeToolScreenShell("Инструменты",onBack) { padding ->
        LazyColumn(Modifier.fillMaxSize().navigationBarsPadding(),contentPadding=PaddingValues(start=16.dp,end=16.dp,top=padding.calculateTopPadding()+16.dp,bottom=16.dp+padding.calculateBottomPadding()),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            item {
                Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
                    NativePaperTextField(query,onQueryChange,"Найти инструмент",Modifier.fillMaxWidth())
                    FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                        NativePaperButton("Все",{kind=null},primary=kind==null)
                        NativeToolKind.entries.forEach { value -> NativePaperButton(if(value==NativeToolKind.Calculator) "Калькуляторы" else "Шкалы и опросники",{kind=value},primary=kind==value,glyph=if(value==NativeToolKind.Calculator) NativeAppGlyphName.Calculator else NativeAppGlyphName.ListChecks) }
                    }
                    Text("Найдено: ${matches.size} · в базе инструментов: ${core.tools().size}",style=MaterialTheme.typography.labelMedium)
                    Text("Поиск по названиям и описаниям инструментов. Результат расчёта требует исходных данных и отдельного подтверждения.",color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            items(matches,key={it.tool.id}) { match ->
                val record=match.tool
                NativePaperSurface(Modifier.fillMaxWidth().clickable { onOpenTool(record) }) {
                    Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
                            Text("${record.bankLabel} · ${record.version}",Modifier.weight(1f),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                            NativePaperIconButton(NativeAppGlyphName.Bookmark,{onSaveItem(nativeToolItem(record))},"Сохранить ${record.title}")
                        }
                        Text(record.title,style=MaterialTheme.typography.titleMedium)
                        Text(record.description,color=MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(when(record.audience) { "adult" -> "Взрослые";"pediatric" -> "Дети";"all" -> "Все";else -> record.audience },style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                        NativePaperButton("Открыть",{onOpenTool(record)},glyph=if(match.kind==NativeToolKind.Calculator) NativeAppGlyphName.Calculator else NativeAppGlyphName.ListChecks)
                    }
                }
            }
            item { Text("Преобразование единиц и измерения по фото ЭКГ пока недоступны в этой нативной версии: их отдельные движки ещё не перенесены.",color=MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}
