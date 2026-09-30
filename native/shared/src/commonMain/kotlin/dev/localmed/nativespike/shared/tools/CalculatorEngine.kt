package dev.localmed.nativespike.shared.tools

import dev.localmed.nativespike.shared.text.jsNumberToString

internal fun toolInputPresent(value: NativeToolInput?) = value != null && value != NativeToolInput.Text("")
internal class CalculatorEngine(private val expressions: ToolExpression) {
    fun initialValues(schema: NativeCalculatorDefinition): Map<String, String> = buildMap {
        for(input in schema.inputs) when {
            !input.options.isNullOrEmpty() -> put(input.id, toolValueString(input.options.first().value))
            input.kind == "checkbox" -> put(input.id, "0")
            input.kind == "date" && input.defaultExpression != null -> put(input.id, toolValueString(expressions.evaluate(input.defaultExpression, emptyMap())))
        }
    }
    private fun requirements(schema: NativeCalculatorDefinition, maxStep: Int) = schema.inputRequirements.filter { r -> r.inputIds.all { id -> (schema.inputs.find { it.id == id }?.step ?: 0) <= maxStep } }
    fun ready(schema: NativeCalculatorDefinition, raw: Map<String, NativeToolInput>, maxStep: Int = Int.MAX_VALUE) = schema.inputs.filter { it.step <= maxStep && it.required }.all { toolInputPresent(raw[it.id]) } && requirements(schema, maxStep).all { r -> r.inputIds.any { toolInputPresent(raw[it]) } }
    fun evaluate(schema: NativeCalculatorDefinition, raw: Map<String, NativeToolInput>, maxStep: Int? = null): NativeCalculatorResult = try { evaluateInner(schema, raw, maxStep) } catch(cause: Exception) { NativeCalculatorResult.Failure("Калькулятор: ${cause.message}") }
    private fun evaluateInner(schema: NativeCalculatorDefinition, raw: Map<String, NativeToolInput>, maxStep: Int?): NativeCalculatorResult {
        fun failure(error: String) = NativeCalculatorResult.Failure(error)
        val scope = linkedMapOf<String, NativeToolInput>(); val stage = maxStep ?: Int.MAX_VALUE
        for(input in schema.inputs) {
            if(input.step > stage) continue
            val rawValue = raw[input.id]
            if(!toolInputPresent(rawValue)) {
                if(input.required) return failure("${input.label}: значение обязательно.")
                if(input.defaultExpression != null) try { expressions.evaluate(input.defaultExpression, scope)?.let { scope[input.id] = it } } catch(cause: Exception) { return failure("${input.label} (значение по умолчанию): ${cause.message}") }
                continue
            }
            checkNotNull(rawValue)
            when(input.kind) {
                "number" -> {
                    val value = toolNumericInput(rawValue)
                    if(!value.isFinite()) return failure("${input.label}: требуется конечное число.")
                    if(input.integer == true && value % 1.0 != 0.0) return failure("${input.label}: требуется целое число.")
                    if(input.minimum != null && value < input.minimum) return failure("${input.label}: значение меньше допустимого минимума ${jsNumberToString(input.minimum)}.")
                    if(input.maximum != null && value > input.maximum) return failure("${input.label}: значение больше допустимого максимума ${jsNumberToString(input.maximum)}.")
                    scope[input.id] = NativeToolInput.Number(value)
                }
                "date" -> {
                    val text = toolValueString(rawValue)
                    if(!ToolDate.pattern.matches(text)) return failure("${input.label}: некорректная дата.")
                    try { ToolDate.parse(NativeToolInput.Text(text), input.label) } catch(cause: ToolExpressionError) { return failure("${input.label}: некорректная дата.") }
                    scope[input.id] = NativeToolInput.Text(text)
                }
                "text" -> scope[input.id] = NativeToolInput.Text(toolValueString(rawValue))
                "checkbox" -> {
                    if(rawValue !in listOf(NativeToolInput.Number(0.0), NativeToolInput.Number(1.0), NativeToolInput.Text("0"), NativeToolInput.Text("1"))) return failure("${input.label}: недопустимое значение.")
                    scope[input.id] = NativeToolInput.Number(toolNumericInput(rawValue))
                }
                else -> {
                    val allowed = input.options.orEmpty().firstOrNull { toolValueString(it.value) == toolValueString(rawValue) } ?: return failure("${input.label}: недопустимое значение.")
                    scope[input.id] = allowed.value
                }
            }
        }
        requirements(schema, stage).firstOrNull { r -> r.inputIds.none { toolInputPresent(raw[it]) } }?.let { return failure(it.message) }
        val trace = mutableListOf<NativeToolTrace>(); val outputs = mutableListOf<NativeCalculatorOutput>()
        for(step in schema.steps) {
            if(step.stepRequired > stage) continue
            val node = try { expressions.parse(step.expression) } catch(cause: Exception) { return failure("${step.label}: ${cause.message}") }
            val value = try { expressions.evaluate(node, scope) } catch(cause: Exception) { return failure("${step.label}: ${cause.message}") } ?: continue
            when(step.valueKind) {
                "date" -> {
                    if(value !is NativeToolInput.Text || !ToolDate.pattern.matches(value.value)) return failure("${step.label}: результат не является корректной датой.")
                    scope[step.id] = value
                    if(step.isOutput) { val date = try { ToolDate.parse(value, "date output").russian() } catch(cause: ToolExpressionError) { return failure("${step.label}: результат не является корректной датой.") }; outputs += NativeCalculatorOutput.Text(step.id, step.label, date) }
                }
                "text" -> {
                    if(value !is NativeToolInput.Text) return failure("${step.label}: результат не является текстом.")
                    scope[step.id] = value; if(step.isOutput) outputs += NativeCalculatorOutput.Text(step.id, step.label, value.value)
                }
                else -> {
                    if(value !is NativeToolInput.Number || !value.value.isFinite()) return failure("${step.label}: результат не является конечным числом.")
                    trace += NativeToolTrace(step.id, step.label, expressions.render(node, scope), value.value, step.unit)
                    scope[step.id] = value; if(step.isOutput) outputs += NativeCalculatorOutput.Number(step.id, step.label, value.value, step.unit, step.displayPrecision)
                }
            }
        }
        if(outputs.isEmpty()) return failure("Калькулятор не определил ни одного результата.")
        val warnings = schema.warnings.toMutableList()
        var evaluation = NativeToolEvaluation(schema.evaluation.status, missingContext = schema.evaluation.missingContext, reason = schema.evaluation.reason, sourceIds = schema.evaluation.sourceIds)
        if(maxStep == null) {
            for(assertion in schema.assertions) {
                val match = try { expressions.evaluate(assertion.`when`, scope) } catch(cause: Exception) { return failure("Проверка результата: ${cause.message}") }
                if(match == NativeToolInput.Number(1.0)) return failure(assertion.error)
            }
            for(interpretation in schema.interpretations) {
                val match = try { expressions.evaluate(interpretation.`when`, scope) } catch(cause: Exception) { return failure("Интерпретация результата: ${cause.message}") }
                if(match == NativeToolInput.Number(1.0)) { warnings += NativeToolWarning("interpretation", interpretation.message); break }
            }
            if(schema.evaluation.status == "verdict") {
                var verdict: NativeToolVerdict? = null
                for(rule in schema.evaluation.rules) {
                    val match = try { expressions.evaluate(rule.`when`, scope) } catch(cause: Exception) { return failure("Оценка результата: ${cause.message}") }
                    if(match == NativeToolInput.Number(1.0)) { verdict = rule.verdict; break }
                }
                if(verdict != null) evaluation = NativeToolEvaluation("verdict", verdict, emptyList(), sourceIds = verdict.sourceIds)
                // Source engine retains its base status if no rule matches; do not infer a new verdict.
                if(evaluation.status != "verdict") evaluation = NativeToolEvaluation("unavailable", missingContext = emptyList(), reason = "Для рассчитанного результата не найдено правило оценки.", sourceIds = schema.evaluation.sourceIds)
            }
        }
        for(visual in schema.visuals) when(val result = evaluateToolVisual(visual, scope, expressions)) {
            is ToolVisualResult.Failure -> return failure(result.error)
            is ToolVisualResult.Success -> result.output?.let { outputs += it }
        }
        return NativeCalculatorResult.Success(schema.id, schema.formulaDisplay, outputs, trace, warnings, evaluation)
    }
}
