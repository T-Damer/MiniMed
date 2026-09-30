package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.tools.NativeToolDefinition
import dev.localmed.nativespike.shared.user.NativeToolEntry
import dev.localmed.nativespike.shared.user.NativeToolRoute
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

@Composable
fun NativeToolsPane(session: NativeCoreSession) {
    val core by session.tools.collectAsState()
    val saved by session.toolsState.snapshot.collectAsState()
    val query by session.toolsQuery.collectAsState()
    val kind by session.toolsKind.collectAsState()
    val errors by session.uiErrors.messages.collectAsState()
    val route=saved?.route ?: return
    val current=core ?: return
    val back={session.actionScope.launch { session.back() };Unit}
    val onSave={item: dev.localmed.nativespike.shared.user.NativeItemRef -> session.actionScope.launch { session.openCollections(item) };Unit}
    val record=(route as? NativeToolRoute.Tool)?.let { current.tool(it.id)?.takeIf { record -> record.version==it.version } }
    DisposableEffect(session,route) {
        val unregister=session.registerNavigationFlush {
            if(record!=null) session.saveTool(record) else session.saveToolsQuery()
        }
        onDispose { unregister() }
    }
    if(route==NativeToolRoute.Catalog) LaunchedEffect(session) {
        snapshotFlow { session.toolsQuery.value }.distinctUntilChanged().collectLatest { session.saveToolsQuery() }
    }
    if(record!=null) {
        LaunchedEffect(session,record.id,record.version) {
            snapshotFlow { when(record.definition) {
                is NativeToolDefinition.Calculator -> session.calculatorState(record).let { it.snapshot() to it.result }
                is NativeToolDefinition.Assessment -> session.assessmentState(record).let { it.snapshot() to it.result }
            } }.distinctUntilChanged().collectLatest { session.saveTool(record) }
        }
    }
    Column(Modifier.fillMaxSize()) {
        errors[NativeUiOperation.ToolsState]?.let { message ->
            Text(message,Modifier.padding(12.dp),color=MaterialTheme.colorScheme.onSurface)
            TextButton(onClick={session.actionScope.launch { if(record!=null) session.saveTool(record) else session.loadTools() }}) { Text("Повторить сохранение") }
        }
        Box(Modifier.weight(1f)) {
            when(route) {
                NativeToolRoute.Catalog -> NativeToolsScreen(current,query,
                    kind = kind, onKindChange = session::updateToolsKind,
                    onQueryChange=session::updateToolsQuery,
                    onOpenTool={session.actionScope.launch { session.openTool(it.id,NativeToolEntry.Catalog) }},onSaveItem=onSave,onBack=back)
                is NativeToolRoute.Tool -> when(record?.definition) {
                    is NativeToolDefinition.Calculator -> NativeCalculatorScreen(current,record,session.calculatorState(record),onSave,back,evaluate=session::evaluateTool)
                    is NativeToolDefinition.Assessment -> NativeAssessmentScreen(current,record,session.assessmentState(record),onSave,back)
                    null -> NativeToolScreenShell("Инструмент недоступен",back) { padding -> Text("Сохранённая версия отсутствует в этой базе. Ваши данные сохранены.",Modifier.padding(padding).padding(16.dp)) }
                }
            }
        }
    }
}
