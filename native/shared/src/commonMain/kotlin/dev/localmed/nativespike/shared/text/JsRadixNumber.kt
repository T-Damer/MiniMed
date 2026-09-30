package dev.localmed.nativespike.shared.text

/** JS Number radix syntax is ASCII. Radix work is bounded to the binary64 overflow boundary. */
internal fun jsNumberFromRadix(digits: String,radix: Int): Double {
    require(radix in setOf(2,8,16)) { "Unsupported numeric radix" }
    fun digit(char: Char): Int = when(char) {
        in '0'..'9' -> char-'0'
        in 'a'..'f' -> char-'a'+10
        in 'A'..'F' -> char-'A'+10
        else -> -1
    }
    if(digits.isEmpty() || digits.any { digit(it) !in 0 until radix }) return Double.NaN
    val significant=digits.dropWhile { it=='0' }
    if(significant.isEmpty()) return 0.0
    val bitsPerDigit=when(radix) { 2 -> 1;8 -> 3;else -> 4 }
    val leading=digit(significant.first())
    val leadingBits=when { leading>=8 -> 4;leading>=4 -> 3;leading>=2 -> 2;else -> 1 }
    val bitLength=(significant.length.toLong()-1)*bitsPerDigit+leadingBits
    if(bitLength>1024) return Double.POSITIVE_INFINITY
    if(bitLength>53) {
        // JSC ParseInt.h parseIntOverflow sums low-order powers first; decimal conversion differs.
        // Source: WebKit c76c52f5b10d; actual Bun cases qualify this behavior.
        var value=0.0
        var multiplier=1.0
        significant.reversed().forEach { value+=digit(it)*multiplier;multiplier*=radix }
        return value
    }
    return significant.toLong(radix).toDouble()
}
