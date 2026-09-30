package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.tools.*
import dev.localmed.nativespike.shared.text.jsNumberToFixed
import dev.localmed.nativespike.shared.text.jsNumberToString
import dev.localmed.nativespike.shared.user.NativeItemRef
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NativeCalculatorScreen(core: NativeToolCore,record: NativeToolRecord,state: NativeCalculatorUiState,
    onSaveItem: (NativeItemRef) -> Unit,onBack: () -> Unit,
    onSaveResult: ((NativeCalculatorDraft,NativeCalculatorResult.Success) -> Unit)? = null,
    evaluate: suspend (String,Map<String,NativeToolInput>,Int) -> NativeCalculatorResult = { id,values,stage -> core.evaluateCalculator(id,values,stage) }) {
    require(state.toolId==record.id)
    val definition=(record.definition as NativeToolDefinition.Calculator).value
    val maxStage=definition.inputs.maxOfOrNull { it.step } ?: 0
    val scope=rememberCoroutineScope()
    val result=state.result
    fun calculate() {
        if(state.busy) return
        val request=state.snapshot();val values=state.engineInputs()
        state.busy=true
        scope.launch {
            try {
                val evaluated=withContext(Dispatchers.Default) { evaluate(record.id,values,request.stage) }
                state.accept(request,evaluated)
            } catch(cause: CancellationException) { throw cause }
            catch(cause: Exception) { state.accept(request,NativeCalculatorResult.Failure(cause.message ?: "Не удалось выполнить расчёт.")) }
            finally { state.busy=false }
        }
    }
    NativeToolScreenShell(record.shortTitle,onBack,{onSaveItem(nativeToolItem(record))}) { padding ->
        LazyColumn(Modifier.fillMaxSize().navigationBarsPadding(),contentPadding=PaddingValues(start=16.dp,end=16.dp,top=padding.calculateTopPadding()+16.dp,bottom=16.dp+padding.calculateBottomPadding()),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            item {
                Column(verticalArrangement=Arrangement.spacedBy(6.dp)) {
                    Text(record.bankLabel.uppercase(),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(record.title,style=MaterialTheme.typography.headlineSmall)
                    Text(record.description)
                }
            }
            item {
                NativePaperSurface(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                        if(maxStage>0) Text("Этап ${state.stage+1} из ${maxStage+1}",style=MaterialTheme.typography.titleMedium)
                        Text("* Обязательное поле",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                        BoxWithConstraints(Modifier.fillMaxWidth()) {
                            val columns=if(maxWidth>=300.dp && androidx.compose.ui.platform.LocalDensity.current.fontScale<1.3f) 2 else 1
                            Column(verticalArrangement=Arrangement.spacedBy(12.dp)) {
                                definition.inputs.filter { it.step<=state.stage }.chunked(columns).forEach { row ->
                                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                                        row.forEach { input -> Box(Modifier.weight(1f)) {
                                            NativeToolInputField(input,state.inputs[input.id].orEmpty(),{state.changeInput(input.id,it)},!state.busy)
                                        } }
                                        if(row.size<columns) Spacer(Modifier.weight(1f))
                                    }
                                }
                            }
                        }
                        definition.inputRequirements.filter { r -> r.inputIds.all { id -> (definition.inputs.find { it.id==id }?.step ?: 0)<=state.stage } }
                            .forEach { Text(it.message,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant) }
                        if(state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                        NativePaperButton(if(maxStage>0) "Рассчитать этап ${state.stage+1}" else "Рассчитать",::calculate,
                            Modifier.fillMaxWidth(),primary=true,enabled=!state.busy,glyph=NativeAppGlyphName.Calculator)
                        FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                            if(state.stage>0) NativePaperButton("Предыдущий этап",{state.changeStage(state.stage-1)},enabled=!state.busy)
                            if(state.stage<maxStage) NativePaperButton("Следующий этап",{state.changeStage(state.stage+1)},
                                enabled=!state.busy && core.calculatorInputsReady(record.id,state.engineInputs(),state.stage))
                        }
                    }
                }
            }
            when(result) {
                is NativeCalculatorResult.Failure -> item { NativePaperSurface { Text(result.error,Modifier.padding(16.dp),color=MaterialTheme.colorScheme.error) } }
                is NativeCalculatorResult.Success -> {
                    item {
                        NativePaperSurface(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
                                Text("Результат",style=MaterialTheme.typography.headlineSmall)
                                result.outputs.forEach { output -> when(output) {
                                    is NativeCalculatorOutput.Number -> Column(verticalArrangement=Arrangement.spacedBy(4.dp)) {
                                        Text(output.label,style=MaterialTheme.typography.titleSmall)
                                        Text("${jsNumberToFixed(output.value,output.displayPrecision)} ${output.unit}",style=MaterialTheme.typography.headlineMedium)
                                    }
                                    is NativeCalculatorOutput.Text -> Column { Text(output.label,style=MaterialTheme.typography.titleSmall);Text(output.text) }
                                    is NativeCalculatorOutput.Visual -> NativeToolChart(output.chart)
                                } }
                                result.warnings.forEach { Text(it.message,color=MaterialTheme.colorScheme.onSurface) }
                                NativeToolEvaluation(result.evaluation)
                                if(state.stage==maxStage) onSaveResult?.let { save -> NativePaperButton("Сохранить результат",{save(state.snapshot(),result)},glyph=NativeAppGlyphName.Bookmark) }
                            }
                        }
                    }
                    item {
                        NativeToolDisclosure("Формула и шаги") {
                            Column(verticalArrangement=Arrangement.spacedBy(6.dp)) {
                                Text(result.formula)
                                result.trace.forEach { step ->
                                    Text("${step.label}: ${jsNumberToString(step.value)} ${step.unit}")
                                    Text(step.expression,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                    }
                }
                null -> Unit
            }
            if(result !is NativeCalculatorResult.Success) item { NativeToolDisclosure("Формула") { Text(definition.formulaDisplay) } }
            item { NativeToolDetails(record) }
        }
    }
}
