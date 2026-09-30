package dev.localmed.nativespike.shared.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.localmed.nativespike.shared.tools.NativeAssessmentResult
import dev.localmed.nativespike.shared.tools.NativeCalculatorResult
import dev.localmed.nativespike.shared.tools.NativeToolInput
import dev.localmed.nativespike.shared.tools.NativeCalculatorDraft
import dev.localmed.nativespike.shared.tools.NativeAssessmentDraft

/** Hoisted by the host: changing theme or opening settings does not discard a tool draft. */
class NativeCalculatorUiState(val toolId: String, initialValues: Map<String,String>, initialStage: Int = 0) {
    val inputs = mutableStateMapOf<String,String>().apply { putAll(initialValues) }
    var stage by mutableStateOf(initialStage); private set
    var result by mutableStateOf<NativeCalculatorResult?>(null); private set
    var busy by mutableStateOf(false)
    fun changeInput(id: String,value: String) { inputs[id] = value;result = null }
    fun changeStage(value: Int) { require(value >= 0);stage = value;result = null }
    fun snapshot() = NativeCalculatorDraft(toolId,inputs.toMap(),stage)
    fun engineInputs(): Map<String,NativeToolInput> = inputs.mapValues { NativeToolInput.Text(it.value) }
    fun accept(request: NativeCalculatorDraft,value: NativeCalculatorResult): Boolean {
        if(snapshot() != request) return false
        result = value;return true
    }
}
class NativeAssessmentUiState(val toolId: String, initialAnswers: Map<String,Double> = emptyMap()) {
    val answers = mutableStateMapOf<String,Double>().apply { putAll(initialAnswers) }
    var result by mutableStateOf<NativeAssessmentResult?>(null);private set
    var busy by mutableStateOf(false)
    fun answer(id: String,value: Double) { answers[id] = value;result = null }
    fun snapshot() = NativeAssessmentDraft(toolId,answers.toMap())
    fun accept(request: NativeAssessmentDraft,value: NativeAssessmentResult): Boolean {
        if(snapshot() != request) return false
        result = value;return true
    }
}
