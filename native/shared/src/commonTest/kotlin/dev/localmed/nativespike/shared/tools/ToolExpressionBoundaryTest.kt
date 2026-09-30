package dev.localmed.nativespike.shared.tools

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ToolExpressionBoundaryTest {
    @Test fun schemaGrammarKeepsRightPowerAndExistingUnaryPrecedence() {
        val root = assertIs<ToolExpressionNode.Binary>(parseToolExpression("-2 ^ 3 ^ 2"))
        assertEquals("^", root.operator)
        assertIs<ToolExpressionNode.Unary>(root.left)
        assertEquals("^", assertIs<ToolExpressionNode.Binary>(root.right).operator)
        val comparison = assertIs<ToolExpressionNode.Binary>(parseToolExpression("1 + 2 * 3 >= 4"))
        assertEquals(">=", comparison.operator)
        assertEquals("+", assertIs<ToolExpressionNode.Binary>(comparison.left).operator)
    }
    @Test fun expressionDataCannotInvokeCodePropertiesOrUnknownFunctions() {
        for(source in listOf("eval(1)", "today(1)", "x.y", "x[0]", "new Date()", "pow(2)", "1;2", "1e3", "\"unterminated")) assertFailsWith<ToolExpressionError> { parseToolExpression(source) }
        assertIs<ToolExpressionNode.Call>(parseToolExpression("cond(present(weight), weight, 0)"))
    }
    @Test fun utcDateArithmeticPreservesLeapBirthdaysAndSourceRollover() {
        val leap = ToolDate.parse(NativeToolInput.Text("2024-02-28"), "date")
        assertEquals("2024-02-29", leap.addDays(1.0)!!.iso())
        assertEquals("2024-03-01", leap.addDays(2.0)!!.iso())
        assertEquals("2024-03-02", ToolDate.parse(NativeToolInput.Text("2024-02-31"), "date").iso())
        assertEquals("29 февраля 2024 г.", leap.addDays(1.0)!!.russian())
        for(value in listOf("2024-00-10", "2024-13-10", "2024-02-00", "2024-2-10")) assertFailsWith<ToolExpressionError> { ToolDate.parse(NativeToolInput.Text(value), "date") }
    }
    @Test fun inputCoercionRetainsJsWhitespaceAndRefusesNonFiniteNumbersAtEngineBoundary() {
        assertEquals(0.0, toolNumericInput(NativeToolInput.Text(" \u00a0\ufeff")))
        assertEquals(16.0, toolNumericInput(NativeToolInput.Text("0x10")))
        assertEquals(0.005, toolNumericInput(NativeToolInput.Text("5e-3")))
        assertTrue(toolNumericInput(NativeToolInput.Text("1,5")).isNaN())
        assertTrue(!toolNumericInput(NativeToolInput.Number(Double.POSITIVE_INFINITY)).isFinite())
        assertTrue(!toolJsWhitespace('\u0085'))
    }
    @Test fun actualTraceFormatterKeepsScientificExponentAndRoundedIntegerZeros() {
        assertEquals("1.23457e-10", toolTraceNumber(1.234567e-10))
        assertEquals("1e-20", toolTraceNumber(1e-20))
        assertEquals("100000", toolTraceNumber(99999.96))
        assertEquals("1.23457", toolTraceNumber(1.234567))
    }
    @Test fun sourceNumberCoercionAcceptsExactLargeRadixValuesAndRejectsSignedDigits() {
        val rows = listOf(
            "0x8000000000000000" to 4890909195324358656L,
            "0xffffffffffffffff" to 4895412794951729152L,
            "0x20000000000001" to 4845873199050653696L,
            "0x20000000000003" to 4845873199050653698L,
            "0b100000000000000000000000000000000000000000000000000000000000000000000000000000000" to 4967470388989657088L,
            "0o10000000000000000000000000000000000000000" to 5147614374084476928L,
            "0x10000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" to 9218868437227405312L,
            "0x+1" to 9221120237041090560L,
            "0x-1" to 9221120237041090560L,
            "+0x1" to 9221120237041090560L,
            "0x" to 9221120237041090560L,
            "0X8Fb" to 4657273969538236416L,
            " \u00a0\ufeff0x8000000000000000 " to 4890909195324358656L,
            "0b102" to 9221120237041090560L,
            "0o8" to 9221120237041090560L,
        )
        for((input, bits) in rows) {
            val actual = toolNumericInput(NativeToolInput.Text(input))
            if(Double.fromBits(bits).isNaN()) assertTrue(actual.isNaN(), "Expected NaN for radix input")
            else assertEquals(bits, actual.toBits(), "Large radix Number coercion")
        }
    }
}
