package dev.localmed.nativespike.shared.tools

import dev.localmed.nativespike.shared.lexical.localeCompareApprox
import dev.localmed.nativespike.shared.text.jsMathRound
import dev.localmed.nativespike.shared.text.jsNumberToString

internal class AssessmentEngine(private val expressions: ToolExpression) {
    private fun options(definition: NativeAssessmentDefinition, question: NativeAssessmentQuestion) = question.responseOptions ?: definition.responseOptions
    private fun scoreScope(scores: List<NativeAssessmentScaleScore>, answers: Map<String, Double> = emptyMap()): Map<String, NativeToolInput> = buildMap {
        fun number(key: String, value: Double) { put(key, NativeToolInput.Number(value)) }
        for(score in scores) { val stable = score.scaleId.replace('-', '_'); if(Regex("^[A-Za-z_][A-Za-z0-9_]*$").matches(score.scaleId)) number(score.scaleId, score.rawScore); number(stable, score.rawScore); number("score_$stable", score.rawScore); number("percent_$stable", score.percent) }
        for((id, value) in answers) number("answer_${id.replace('-', '_')}", value)
        if(scores.size == 1) { number("score", scores[0].rawScore); number("total", scores[0].rawScore) }
    }
    private fun evaluation(definition: NativeAssessmentDefinition, scores: List<NativeAssessmentScaleScore>): NativeToolEvaluation {
        val declared = definition.evaluation
        val base = NativeToolEvaluation(declared.status, missingContext = declared.missingContext, reason = declared.reason, sourceIds = declared.sourceIds)
        if(declared.status != "verdict") return base
        if(declared.rules.isEmpty()) return base.copy(status = "unavailable", reason = base.reason ?: "Для этого результата не объявлено вычисляемое правило оценки.")
        val scope = scoreScope(scores)
        for(rule in declared.rules) {
            val match = try { expressions.evaluate(rule.`when`, scope) } catch(cause: Exception) { return base.copy(status = "unavailable", reason = "Правило оценки ссылается на недоступный балл.") }
            if(match == NativeToolInput.Number(1.0)) return base.copy(status = "verdict", verdict = rule.verdict, sourceIds = rule.verdict.sourceIds.ifEmpty { declared.sourceIds })
        }
        return base.copy(status = "unavailable", reason = "Ни одно объявленное правило оценки не подошло к рассчитанным баллам.")
    }
    private fun genericHeadline(scores: List<NativeAssessmentScaleScore>): String { val names = scores.take(2).map { it.label }; return if(names.size > 1) "Наиболее выражены: ${names.joinToString(" и ")}" else "Наиболее выражена шкала: ${names.firstOrNull() ?: "нет данных"}" }
    private fun interpretation(definition: NativeAssessmentDefinition, scores: List<NativeAssessmentScaleScore>, answers: Map<String, Double>): NativeAssessmentInterpretation? {
        val scope = scoreScope(scores, answers)
        for(band in definition.interpretations.orEmpty()) {
            if(!band.`when`.isNullOrEmpty()) { if(expressions.evaluate(band.`when`, scope) == NativeToolInput.Number(1.0)) return band; continue }
            val id = band.scaleId ?: definition.scales.firstOrNull()?.id ?: continue
            val score = scores.firstOrNull { it.scaleId == id }?.rawScore ?: continue
            if(band.minScore != null && band.maxScore != null && score >= band.minScore && score <= band.maxScore) return band
        }
        return null
    }
    fun score(definition: NativeAssessmentDefinition, answers: Map<String, Double>, completedAt: String): NativeAssessmentResult {
        fun failure(message: String) = NativeAssessmentResult.Failure(message)
        if(definition.scoringMode == "responses-only") {
            for(question in definition.questions) {
                val values = options(definition, question).map { it.value }
                if(values.size < 2 || values.any { !it.isFinite() } || values.distinct().size != values.size) return failure("У опросника неверно настроены варианты ответов.")
                val answer = answers[question.id] ?: return failure("Не заполнен пункт: «${question.prompt}».")
                if(values.none { it == answer }) return failure("Недопустимое значение ответа для пункта ${question.id}.")
            }
            return NativeAssessmentResult.Success(NativeAssessmentScore(definition.id, completedAt, emptyList(), emptyList(), "Опросник заполнен", "Выбранные ответы сохранены без подсчёта баллов.", definition.disclaimer, evaluation = evaluation(definition, emptyList())))
        }
        data class Total(val raw: Double = 0.0, val min: Double = 0.0, val max: Double = 0.0)
        val totals = mutableMapOf<String, Total>()
        for(question in definition.questions) {
            val values = options(definition, question).map { it.value }; val minimum = values.minOrNull() ?: Double.POSITIVE_INFINITY; val maximum = values.maxOrNull() ?: Double.NEGATIVE_INFINITY
            if(!minimum.isFinite() || !maximum.isFinite() || minimum == maximum) return failure("У опросника неверно настроена шкала ответов.")
            val answer = answers[question.id] ?: return failure("Не заполнен пункт: «${question.prompt}».")
            if(values.none { it == answer }) return failure("Недопустимое значение ответа для пункта ${question.id}.")
            if(definition.scales.none { it.id == question.scaleId }) return failure("Пункт ${question.id} ссылается на неизвестную шкалу.")
            val current = totals[question.scaleId] ?: Total()
            totals[question.scaleId] = Total(current.raw + if(question.reverse == true) minimum + maximum - answer else answer, current.min + minimum, current.max + maximum)
        }
        val scores = definition.scales.map { scale ->
            val total = totals[scale.id] ?: Total(); val percent = if(total.max == total.min) 0.0 else jsMathRound(((total.raw - total.min) / (total.max - total.min)) * 100 * 10) / 10
            NativeAssessmentScaleScore(scale.id, scale.label, scale.shortLabel, total.raw, total.min, total.max, percent)
        }.sortedWith { left, right -> right.percent.compareTo(left.percent).takeIf { it != 0 } ?: localeCompareApprox(left.label, right.label) }
        val highest = scores.firstOrNull()?.percent ?: 0.0; val primary = scores.filter { highest - it.percent <= 5 }.take(2).map { it.scaleId }
        val clinical = try { interpretation(definition, scores, answers) } catch(cause: Exception) { return failure("В схеме опросника неверно настроено правило интерпретации.") }
        val visuals = mutableListOf<NativeToolChart>()
        for(visual in definition.visuals) when(val result = evaluateToolVisual(visual, scoreScope(scores, answers), expressions)) {
            is ToolVisualResult.Failure -> return failure(result.error)
            is ToolVisualResult.Success -> result.output?.let { visuals += it.chart }
        }
        val summary = clinical?.message ?: "${genericHeadline(scores)}. Нормированные показатели: ${scores.take(3).joinToString("; ") { "${it.shortLabel} — ${jsNumberToString(it.percent)}%" }}. Профиль показывает относительную выраженность шкал внутри этого опросника, а не сравнение с популяционной нормой."
        return NativeAssessmentResult.Success(NativeAssessmentScore(definition.id, completedAt, scores, primary, clinical?.headline ?: genericHeadline(scores), summary, definition.disclaimer, visuals.takeIf { it.isNotEmpty() }, evaluation(definition, scores)))
    }
}
