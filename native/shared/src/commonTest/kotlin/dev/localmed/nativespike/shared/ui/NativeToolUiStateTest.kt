package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.tools.*
import kotlin.test.*

class NativeToolUiStateTest {
    @Test fun calculatorRetainsRawDraftStageAndRejectsLateOldInputResult() {
        val state=NativeCalculatorUiState("source.calc",mapOf("date" to "2026-09-30","weight" to "12,5"))
        assertEquals(NativeToolInput.Text("12,5"),state.engineInputs()["weight"])
        val first=state.snapshot()
        assertTrue(state.accept(first,NativeCalculatorResult.Failure("Недостаточно данных")))
        state.changeInput("weight","13.0")
        assertNull(state.result)
        assertFalse(state.accept(first,NativeCalculatorResult.Failure("Устаревший результат")))
        state.changeStage(1)
        val restored=NativeCalculatorUiState(state.toolId,state.snapshot().inputs,state.snapshot().stage)
        assertEquals(state.snapshot(),restored.snapshot())
        assertFalse(state.accept(first,NativeCalculatorResult.Failure("Устаревший этап")))
    }
    @Test fun assessmentChangedAnswerInvalidatesOldScoreAndDraftSurvivesHostRecreation() {
        val state=NativeAssessmentUiState("source.assessment")
        state.answer("question",1.0);val first=state.snapshot()
        assertTrue(state.accept(first,NativeAssessmentResult.Failure("Заполните остальные вопросы")))
        state.answer("question",2.0)
        assertNull(state.result)
        assertFalse(state.accept(first,NativeAssessmentResult.Failure("Устаревший ответ")))
        val restored=NativeAssessmentUiState(state.toolId,state.snapshot().answers)
        assertEquals(state.snapshot(),restored.snapshot())
    }
}
