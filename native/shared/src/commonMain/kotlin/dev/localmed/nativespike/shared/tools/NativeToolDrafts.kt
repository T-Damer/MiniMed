package dev.localmed.nativespike.shared.tools

import kotlinx.serialization.Serializable

@Serializable data class NativeCalculatorDraft(val toolId: String, val inputs: Map<String,String>, val stage: Int = 0)
@Serializable data class NativeAssessmentDraft(val toolId: String, val answers: Map<String,Double> = emptyMap())

