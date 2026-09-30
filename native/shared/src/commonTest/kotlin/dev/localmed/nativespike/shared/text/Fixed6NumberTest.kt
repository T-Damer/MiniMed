package dev.localmed.nativespike.shared.text

import dev.localmed.nativespike.shared.lexical.analyzeClinicalQuery
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class Fixed6NumberTest {
    @Test
    fun actualTsBinaryRoundingAndNumberNotationBoundaries() {
        val cases = listOf(
            0.0078125 to "0.007813", 1.0000015 to "1.000001", 0.000001 to "0.000001",
            -0.0078125 to "-0.007813", -1.0000015 to "-1.000001", -0.0 to "0",
            Double.MIN_VALUE to "0", 0.0000005 to "0", 0.0000005000000001 to "0.000001",
            70.0 to "70", 3.025 to "3.025", 1e20 to "100000000000000000000",
            1e21 to "1e+21", 1e23 to "1e+23", Double.MAX_VALUE to "1.7976931348623157e+308",
            1000000000000000100.0 to "1000000000000000100",
            1208925819614629174706176.0 to "1.2089258196146292e+24",
        )
        cases.forEachIndexed { index, (value, expected) -> assertEquals(expected, fixed6NumberString(value), "Numeric case $index") }
    }

    @Test
    fun parsedKilogramsGramsZeroAndNonfiniteAmountsFollowTheActualSourceContract() {
        val cases=listOf("0.0078125 кг" to "0.007813 кг", "1.0000015 кг" to "1.000001 кг",
            "0.000001 кг" to "0.000001 кг", "7.8125 г" to "0.007813 кг", "-0 кг" to "0 кг",
            "100000000000000000000000 кг" to "1e+23 кг")
        cases.forEachIndexed { index,(input,expected) ->
            assertEquals(expected,analyzeClinicalQuery("Масса $input",emptyList(),false).analysis.clinicalContext.weight.single().normalizedValue,"Parser case $index")
        }
        assertTrue(analyzeClinicalQuery("Масса ${"9".repeat(400)} кг",emptyList(),false).analysis.clinicalContext.weight.isEmpty())
    }
}
