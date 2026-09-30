package dev.localmed.nativespike.shared.tools

import dev.localmed.nativespike.shared.text.jsMathRound
import dev.localmed.nativespike.shared.text.jsNumberFromRadix
import dev.localmed.nativespike.shared.text.jsNumberToPrecision6
import dev.localmed.nativespike.shared.text.jsNumberToString
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.sqrt

internal class ToolExpressionError(message: String) : IllegalArgumentException(message)
internal sealed interface ToolExpressionNode {
    data class Literal(val value: NativeToolInput) : ToolExpressionNode
    data class Variable(val name: String) : ToolExpressionNode
    data class Unary(val operand: ToolExpressionNode) : ToolExpressionNode
    data class Binary(val operator: String, val left: ToolExpressionNode, val right: ToolExpressionNode) : ToolExpressionNode
    data class Call(val name: String, val args: List<ToolExpressionNode>) : ToolExpressionNode
}
private data class Token(val kind: String, val value: String = "")
private val functionArities = mapOf("min" to 2, "max" to 2, "abs" to 1, "sqrt" to 1, "round" to 1, "floor" to 1, "pow" to 2, "exp" to 1, "cond" to 3, "optional" to 2, "present" to 1, "today" to 0, "addDays" to 2, "daysBetween" to 2, "yearsBetween" to 2, "whoLmsZ" to 4, "whoLmsValue" to 4, "whoPercentile" to 1, "whoBand" to 2, "aapBpHeightPercentile" to 3, "aapBpThreshold" to 5, "aapBpCategory" to 5, "aapBpCategoryLabel" to 1, "gailRisk" to 8, "asccpRiskBand" to 6)
private val operators = listOf("==", "!=", "<=", ">=", "<", ">", "+", "-", "*", "/", "^")
private val comparisons = setOf("==", "!=", "<", "<=", ">", ">=")
internal fun toolJsWhitespace(c: Char) = c in "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2028\u2029\u202f\u205f\u3000\ufeff" || c in '\u2000'..'\u200a'
private fun tokenize(source: String): List<Token> {
    val result = mutableListOf<Token>(); var index = 0
    while (index < source.length) {
        val c = source[index]
        when {
            toolJsWhitespace(c) -> index++
            c == '(' || c == ')' || c == ',' -> { result += Token(c.toString()); index++ }
            c == '"' -> { val end = source.indexOf('"', index + 1); if (end < 0) throw ToolExpressionError("Unterminated string literal at $index."); result += Token("string", source.substring(index + 1, end)); index = end + 1 }
            c in '0'..'9' || c == '.' -> { val match = Regex("^\\d+(?:\\.\\d+)?").find(source.substring(index)) ?: throw ToolExpressionError("Invalid number at $index."); result += Token("number", match.value); index += match.value.length }
            c in 'a'..'z' || c in 'A'..'Z' || c == '_' -> { val match = Regex("^[a-zA-Z_][a-zA-Z0-9_]*").find(source.substring(index)) ?: throw ToolExpressionError("Invalid identifier at $index."); result += Token("identifier", match.value); index += match.value.length }
            else -> { val operator = operators.firstOrNull { source.startsWith(it, index) } ?: throw ToolExpressionError("Unexpected character \"$c\" at $index."); result += Token("operator", operator); index += operator.length }
        }
    }
    return result
}
private class ExpressionParser(private val tokens: List<Token>) {
    private var position = 0
    private fun peek() = tokens.getOrNull(position)
    private fun next() = tokens.getOrNull(position++) ?: throw ToolExpressionError("Unexpected end of expression.")
    fun parse(): ToolExpressionNode { val result = comparison(); if (position != tokens.size) throw ToolExpressionError("Unexpected trailing tokens in expression."); return result }
    private fun binary(nextLevel: () -> ToolExpressionNode, accepted: Set<String>): ToolExpressionNode {
        var left = nextLevel()
        while (peek()?.kind == "operator" && peek()?.value in accepted) { val op = next().value; left = ToolExpressionNode.Binary(op, left, nextLevel()) }
        return left
    }
    private fun comparison() = binary(::additive, comparisons)
    private fun additive() = binary(::multiplicative, setOf("+", "-"))
    private fun multiplicative() = binary(::power, setOf("*", "/"))
    private fun power(): ToolExpressionNode { val left = unary(); return if (peek()?.kind == "operator" && peek()?.value == "^") { next(); ToolExpressionNode.Binary("^", left, power()) } else left }
    private fun unary(): ToolExpressionNode = if (peek()?.kind == "operator" && peek()?.value == "-") { next(); ToolExpressionNode.Unary(unary()) } else atom()
    private fun atom(): ToolExpressionNode {
        val token = next()
        return when (token.kind) {
            "number" -> ToolExpressionNode.Literal(NativeToolInput.Number(token.value.toDouble()))
            "string" -> ToolExpressionNode.Literal(NativeToolInput.Text(token.value))
            "(" -> { val inner = comparison(); if (next().kind != ")") throw ToolExpressionError("Expected \")\"."); inner }
            "identifier" -> {
                if (peek()?.kind != "(") return ToolExpressionNode.Variable(token.value)
                next(); val args = mutableListOf<ToolExpressionNode>()
                if (peek()?.kind != ")") { args += comparison(); while (peek()?.kind == ",") { next(); args += comparison() } }
                if (next().kind != ")") throw ToolExpressionError("Expected \")\" after arguments.")
                val arity = functionArities[token.value] ?: throw ToolExpressionError("Unknown function \"${token.value}\".")
                if (args.size != arity) throw ToolExpressionError("Function \"${token.value}\" expects $arity argument(s), got ${args.size}.")
                ToolExpressionNode.Call(token.value, args)
            }
            else -> throw ToolExpressionError("Unexpected token in expression.")
        }
    }
}
internal fun parseToolExpression(source: String): ToolExpressionNode = ExpressionParser(tokenize(source)).parse()
internal fun toolValueString(value: NativeToolInput?): String = when(value) { is NativeToolInput.Number -> jsNumberToString(value.value); is NativeToolInput.Text -> value.value; null -> "undefined" }
internal fun toolAsNumber(value: NativeToolInput?): Double = (value as? NativeToolInput.Number)?.value ?: throw ToolExpressionError("Expected a number, got a string (\"${toolValueString(value)}\").")
internal fun toolAsString(value: NativeToolInput?): String = (value as? NativeToolInput.Text)?.value ?: throw ToolExpressionError("Expected a string, got a number (${toolValueString(value)}).")
internal fun toolNumericInput(value: NativeToolInput): Double = when(value) {
    is NativeToolInput.Number -> value.value
    is NativeToolInput.Text -> {
        val text = value.value.trim(::toolJsWhitespace)
        when {
            text.isEmpty() -> 0.0
            text == "Infinity" || text == "+Infinity" -> Double.POSITIVE_INFINITY
            text == "-Infinity" -> Double.NEGATIVE_INFINITY
            text.startsWith("0x", true) -> jsNumberFromRadix(text.drop(2), 16)
            text.startsWith("0b", true) -> jsNumberFromRadix(text.drop(2), 2)
            text.startsWith("0o", true) -> jsNumberFromRadix(text.drop(2), 8)
            Regex("^[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?$").matches(text) -> text.toDoubleOrNull() ?: Double.NaN
            else -> Double.NaN
        }
    }
}
internal class ToolExpression(private val bank: NativeToolBank, private val context: NativeToolContext) {
    private val who = WhoGrowthReference(bank.who)
    private val aap = AapBloodPressureReference(bank.aap)
    private val risk = ToolRiskModels(bank.gail)
    private val nodes = mutableMapOf<String, ToolExpressionNode>()
    fun parse(source: String) = nodes.getOrPut(source) { parseToolExpression(source) }
    fun evaluate(source: String, scope: Map<String, NativeToolInput>): NativeToolInput? = evaluate(parse(source), scope)
    fun evaluate(node: ToolExpressionNode, scope: Map<String, NativeToolInput>): NativeToolInput? = when(node) {
        is ToolExpressionNode.Literal -> node.value
        is ToolExpressionNode.Variable -> scope[node.name] ?: throw ToolExpressionError("Unknown variable \"${node.name}\".")
        is ToolExpressionNode.Unary -> NativeToolInput.Number(-toolAsNumber(evaluate(node.operand, scope)))
        is ToolExpressionNode.Call -> call(node, scope)
        is ToolExpressionNode.Binary -> {
            val left = evaluate(node.left, scope); val right = evaluate(node.right, scope)
            if (node.operator in comparisons) {
                val equal = if (left is NativeToolInput.Number && right is NativeToolInput.Number) left.value == right.value else left == right
                val value = when (node.operator) { "==" -> equal; "!=" -> !equal; "<" -> toolAsNumber(left) < toolAsNumber(right); "<=" -> toolAsNumber(left) <= toolAsNumber(right); ">" -> toolAsNumber(left) > toolAsNumber(right); else -> toolAsNumber(left) >= toolAsNumber(right) }
                NativeToolInput.Number(if(value) 1.0 else 0.0)
            } else { val l = toolAsNumber(left); val r = toolAsNumber(right); NativeToolInput.Number(when(node.operator) { "+" -> l + r; "-" -> l - r; "*" -> l * r; "/" -> l / r; "^" -> toolPower(l, r); else -> error("Unsupported operator") }) }
        }
    }
    private fun call(node: ToolExpressionNode.Call, scope: Map<String, NativeToolInput>): NativeToolInput? {
        val args = node.args; val name = node.name
        fun n(index: Int) = toolAsNumber(evaluate(args[index], scope))
        fun s(index: Int) = toolAsString(evaluate(args[index], scope))
        fun number(value: Double) = NativeToolInput.Number(value)
        fun text(value: String) = NativeToolInput.Text(value)
        return when(name) {
            "cond" -> evaluate(if (evaluate(args[0], scope) == NativeToolInput.Number(1.0)) args[1] else args[2], scope)
            "optional" -> if (evaluate(args[0], scope) == NativeToolInput.Number(1.0)) evaluate(args[1], scope) else null
            "present" -> { val arg = args[0] as? ToolExpressionNode.Variable ?: throw ToolExpressionError("present() requires a variable name as its argument."); number(if(scope.containsKey(arg.name)) 1.0 else 0.0) }
            "today" -> text(context.todayIso)
            "addDays" -> text(ToolDate.parse(evaluate(args[0], scope), "addDays").addDays(n(1))?.sourceIso() ?: "NaN-NaN-NaN")
            "daysBetween" -> number(jsMathRound((ToolDate.parse(evaluate(args[1], scope), "daysBetween").epochDay - ToolDate.parse(evaluate(args[0], scope), "daysBetween").epochDay).toDouble()))
            "yearsBetween" -> { val from = ToolDate.parse(evaluate(args[0], scope), "yearsBetween"); val to = ToolDate.parse(evaluate(args[1], scope), "yearsBetween"); number((to.year - from.year - if(to.month < from.month || (to.month == from.month && to.day < from.day)) 1 else 0).toDouble()) }
            "whoLmsZ" -> number(who.zScore(s(0), s(1), n(2), n(3)))
            "whoLmsValue" -> number(who.valueAtZ(s(0), s(1), n(2), n(3)))
            "whoPercentile" -> number(who.percentile(n(0)))
            "whoBand" -> text(who.band(s(0), n(1)))
            "aapBpHeightPercentile" -> number(aap.heightPercentile(s(0), n(1), n(2)))
            "aapBpThreshold" -> number(aap.threshold(s(0), n(1), n(2), s(3), n(4)))
            "aapBpCategory" -> text(aap.category(s(0), n(1), n(2), n(3), n(4)))
            "aapBpCategoryLabel" -> text(aap.categoryLabel(s(0)))
            "gailRisk" -> number(risk.gail(n(0), n(1), s(2), n(3), n(4), n(5), n(6), n(7)))
            "asccpRiskBand" -> number(risk.cervical(n(0), s(1), s(2), s(3), s(4), s(5)))
            else -> { val values = args.map { toolAsNumber(evaluate(it, scope)) }; number(when(name) { "min" -> minOf(values[0], values[1]); "max" -> maxOf(values[0], values[1]); "abs" -> abs(values[0]); "sqrt" -> sqrt(values[0]); "round" -> jsMathRound(values[0]); "floor" -> floor(values[0]); "pow" -> toolPower(values[0], values[1]); "exp" -> exp(values[0]); else -> throw ToolExpressionError("Unknown function \"$name\".") }) }
        }
    }
    fun render(node: ToolExpressionNode, scope: Map<String, NativeToolInput>): String {
        fun formatted(value: NativeToolInput?): String = when(value) {
            null -> "—"
            is NativeToolInput.Text -> "\"${value.value}\""
            is NativeToolInput.Number -> if(value.value.isFinite() && value.value % 1.0 == 0.0) jsNumberToString(value.value) else toolTraceNumber(value.value)
        }
        return when(node) {
            is ToolExpressionNode.Literal -> formatted(node.value)
            is ToolExpressionNode.Variable -> formatted(scope[node.name] ?: NativeToolInput.Text(node.name))
            is ToolExpressionNode.Unary -> "-${render(node.operand, scope)}"
            is ToolExpressionNode.Binary -> "${render(node.left, scope)} ${node.operator} ${render(node.right, scope)}"
            is ToolExpressionNode.Call -> "${node.name}(${node.args.joinToString(", ") { render(it, scope) }})"
        }
    }
}

internal fun toolTraceNumber(value: Double): String {
    val precise = jsNumberToPrecision6(value)
    val parts = precise.split('e', limit = 2)
    val mantissa = if(parts[0].contains('.')) parts[0].replace(Regex("0+$"), "").replace(Regex("\\.$"), "") else parts[0]
    return mantissa + if(parts.size == 2) "e" + parts[1] else ""
}
