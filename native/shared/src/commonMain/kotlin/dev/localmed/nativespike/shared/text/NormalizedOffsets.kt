package dev.localmed.nativespike.shared.text

/** Platform Unicode NFKC, matching String.normalize('NFKC') in the web core. */
internal expect fun compatibilityNormalize(value: String): String

data class TextRange(val start: Int, val end: Int)
data class NormalizedOffsets(val text: String, val offsets: List<TextRange>)

/** Each normalized UTF-16 position maps back to its original Unicode character. */
fun normalizeSurfaceTextWithOffsets(value: String): NormalizedOffsets {
    val text = StringBuilder()
    val offsets = mutableListOf<TextRange>()
    var index = 0
    while (index < value.length) {
        val width = if (value[index].isHighSurrogate() && value.getOrNull(index + 1)?.isLowSurrogate() == true) 2 else 1
        val normalized = compatibilityNormalize(value.substring(index, index + width)).lowercase().replace('ё', 'е')
        for (character in normalized) {
            val folded = if (character in "‐‑‒–—−") '-' else character
            val kept = if (isKeepableChar(folded)) folded else ' '
            if (kept.isWhitespace()) {
                if (text.isNotEmpty() && text.last() != ' ') {
                    text.append(' ')
                    offsets.add(TextRange(index, index + width))
                }
            } else {
                text.append(kept)
                offsets.add(TextRange(index, index + width))
            }
        }
        index += width
    }
    if (text.isNotEmpty() && text.last() == ' ') {
        text.setLength(text.length - 1)
        offsets.removeAt(offsets.lastIndex)
    }
    return NormalizedOffsets(normalizeIcd10Lookalikes(text.toString()), offsets)
}
