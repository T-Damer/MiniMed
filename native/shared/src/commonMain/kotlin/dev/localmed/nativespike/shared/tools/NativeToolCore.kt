package dev.localmed.nativespike.shared.tools

/** Pure schema engine. No clock, SQL, content I/O, network, UI or patient-store dependency. */
class NativeToolCore(bankJson: String, context: NativeToolContext) {
    private val bank = NativeToolBank(bankJson)
    private val expressions = ToolExpression(bank, context)
    private val calculators = CalculatorEngine(expressions)
    private val assessments = AssessmentEngine(expressions)
    init { require(ToolDate.parse(NativeToolInput.Text(context.todayIso), "today").iso() == context.todayIso) { "Tool context must contain a valid UTC ISO day" } }
    val catalogSource: NativeToolModelSource get() = bank.catalogSource
    val moduleSources: List<NativeToolModuleSource> get() = bank.modules
    val modelSources: List<NativeToolModelSource> get() = bank.modelSources
    fun catalogTools(): List<NativeToolRecord> = bank.catalogOrder.map { id -> bank.records.first { it.id == id } }
    fun tools(): List<NativeToolRecord> = bank.records.toList()
    fun tool(id: String): NativeToolRecord? = bank.records.find { it.id == id }
    private fun calculator(id: String) = (tool(id)?.definition as? NativeToolDefinition.Calculator)?.value ?: throw IllegalArgumentException("Calculator is absent from this tool bank")
    private fun assessment(id: String) = (tool(id)?.definition as? NativeToolDefinition.Assessment)?.value ?: throw IllegalArgumentException("Assessment is absent from this tool bank")
    fun initialCalculatorValues(id: String): Map<String, String> = calculators.initialValues(calculator(id))
    fun calculatorInputsReady(id: String, inputs: Map<String, NativeToolInput>, maxStep: Int = Int.MAX_VALUE): Boolean = calculators.ready(calculator(id), inputs, maxStep)
    fun evaluateCalculator(id: String, inputs: Map<String, NativeToolInput>, maxStep: Int? = null): NativeCalculatorResult = calculators.evaluate(calculator(id), inputs, maxStep)
    fun scoreAssessment(id: String, answers: Map<String, Double>, completedAt: String): NativeAssessmentResult = assessments.score(assessment(id), answers, completedAt)
}
