@file:OptIn(kotlin.time.ExperimentalTime::class)

package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.tools.*
import dev.localmed.nativespike.shared.text.jsNumberToString
import dev.localmed.nativespike.shared.user.NativeItemRef
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.time.Clock

@Composable
fun NativeAssessmentScreen(core: NativeToolCore,record: NativeToolRecord,state: NativeAssessmentUiState,
    onSaveItem: (NativeItemRef) -> Unit,onBack: () -> Unit,
    onSaveResult: ((NativeAssessmentDraft,NativeAssessmentScore) -> Unit)? = null) {
    require(state.toolId==record.id)
    val definition=(record.definition as NativeToolDefinition.Assessment).value
    val scope=rememberCoroutineScope()
    fun score() {
        if(state.busy) return
        val request=state.snapshot();val completedAt=Clock.System.now().toString();state.busy=true
        scope.launch {
            try {
                val evaluated=withContext(Dispatchers.Default) { core.scoreAssessment(record.id,request.answers,completedAt) }
                state.accept(request,evaluated)
            } catch(cause: CancellationException) { throw cause }
            catch(cause: Exception) { state.accept(request,NativeAssessmentResult.Failure(cause.message ?: "Не удалось обработать ответы.")) }
            finally { state.busy=false }
        }
    }
    val listState=remember(record.id,record.version) { LazyListState() }
    NativeToolScreenShell(record.shortTitle,onBack,{onSaveItem(nativeToolItem(record))}) { padding ->
        LazyColumn(Modifier.fillMaxSize().navigationBarsPadding(),state=listState,
            contentPadding=PaddingValues(start=16.dp,end=16.dp,top=padding.calculateTopPadding()+16.dp,bottom=16.dp+padding.calculateBottomPadding()),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            item {
                Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
                    Text(record.bankLabel.uppercase(),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(record.title,style=MaterialTheme.typography.headlineSmall);Text(record.description)
                    Text("Примерно ${record.estimatedMinutes} мин.",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(definition.disclaimer,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                        Text("Заполнено ${state.answers.size} из ${definition.questions.size}",style=MaterialTheme.typography.labelMedium)
                        LinearProgressIndicator(progress={if(definition.questions.isEmpty()) 0f else state.answers.size.toFloat()/definition.questions.size},modifier=Modifier.weight(1f))
                    }
                    val missing=definition.questions.indexOfFirst { it.id !in state.answers }
                    if(missing>=0) NativePaperButton("К следующему вопросу",{scope.launch { listState.animateScrollToItem(missing+1) }},glyph=NativeAppGlyphName.CaretDown)
                }
            }
            items(definition.questions,key={it.id}) { question ->
                val index=definition.questions.indexOf(question)
                val answered=question.id in state.answers
                NativePaperSurface(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                        Surface(color=if(answered) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.errorContainer,
                            border=BorderStroke(1.dp,if(answered) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline),shape=RoundedCornerShape(9.dp)) {
                            Row(Modifier.padding(8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                                Text((index+1).toString(),style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.primary)
                                Text(question.prompt,style=MaterialTheme.typography.labelLarge,fontWeight=FontWeight.Bold)
                            }
                        }
                        val options=question.responseOptions ?: definition.responseOptions
                        if(options.size<=5) Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                            options.forEach { option -> NativeAssessmentAnswerTile(option,state.answers[question.id]==option.value,
                                {state.answer(question.id,option.value)},!state.busy,Modifier.weight(1f)) }
                        } else Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                            options.forEach { option -> NativeAssessmentAnswerTile(option,state.answers[question.id]==option.value,
                                {state.answer(question.id,option.value)},!state.busy,Modifier.width(104.dp)) }
                        }
                    }
                }
            }
            item {
                if(state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                NativePaperButton("Получить результат",::score,Modifier.fillMaxWidth(),primary=true,enabled=!state.busy,glyph=NativeAppGlyphName.ListChecks)
            }
            when(val result=state.result) {
                is NativeAssessmentResult.Failure -> item { NativePaperSurface { Text(result.error,Modifier.padding(16.dp),color=MaterialTheme.colorScheme.error) } }
                is NativeAssessmentResult.Success -> {
                    val value=result.value
                    item {
                        NativePaperSurface(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                                Text(value.headline,style=MaterialTheme.typography.headlineSmall);Text(value.summary)
                                Text(value.disclaimer,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                                value.scores.forEach { score ->
                                    Column(verticalArrangement=Arrangement.spacedBy(4.dp)) {
                                        Text(score.label,style=MaterialTheme.typography.titleSmall)
                                        Text("${jsNumberToString(score.rawScore)} · диапазон ${jsNumberToString(score.minimumScore)}–${jsNumberToString(score.maximumScore)} · ${jsNumberToString(score.percent)}%")
                                        LinearProgressIndicator(progress={(score.percent/100).toFloat().coerceIn(0f,1f)},modifier=Modifier.fillMaxWidth())
                                        definition.scales.find { it.id==score.scaleId }?.description?.let { Text(it,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant) }
                                    }
                                }
                                value.visuals.orEmpty().forEach { NativeToolChart(it) }
                                NativeToolEvaluation(value.evaluation)
                                onSaveResult?.let { save -> NativePaperButton("Сохранить результат",{save(state.snapshot(),value)},glyph=NativeAppGlyphName.Bookmark) }
                            }
                        }
                    }
                }
                null -> Unit
            }
            item { NativeToolDetails(record) }
        }
    }
}

@Composable
private fun NativeAssessmentAnswerTile(option: NativeAssessmentOption,selected: Boolean,onSelect: ()->Unit,enabled: Boolean,modifier: Modifier) {
    Surface(modifier=modifier.heightIn(min=88.dp).selectable(selected,enabled=enabled,role=Role.RadioButton,onClick=onSelect),
        color=if(selected) MaterialTheme.colorScheme.primary.copy(alpha=.12f) else MaterialTheme.colorScheme.surfaceVariant,
        shape=RoundedCornerShape(9.dp),border=BorderStroke(if(selected) 2.dp else 1.dp,if(selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline)) {
        Column(Modifier.padding(8.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(6.dp)) {
            if(option.hideValue!=true) Text(jsNumberToString(option.value),style=MaterialTheme.typography.headlineSmall,color=MaterialTheme.colorScheme.primary)
            Text(option.label,style=MaterialTheme.typography.labelMedium,textAlign=TextAlign.Center,color=MaterialTheme.colorScheme.onSurface)
        }
    }
}
