/**
 * Word error rate for the recorder-quality runs (browser Whisper and Android GigaAM): lower case,
 * «ё» as «е», punctuation and TTS markup («[[slnc 900]]») dropped. Numbers written as digits count
 * as errors on both sides.
 */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/gu, 'е')
    .replace(/\[\[[^\]]*\]\]/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean);
}

/** Word-level edit distance. */
export function wordDistance(reference: readonly string[], hypothesis: readonly string[]): number {
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index);
  for (let row = 1; row <= reference.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= hypothesis.length; column += 1) {
      const cost = reference[row - 1] === hypothesis[column - 1] ? 0 : 1;
      current.push(
        Math.min(
          (previous[column] ?? 0) + 1,
          (current[column - 1] ?? 0) + 1,
          (previous[column - 1] ?? 0) + cost,
        ),
      );
    }
    previous = current;
  }
  return previous[hypothesis.length] ?? 0;
}

/**
 * The script repeated as many times as a looping fake microphone played it, and the WER of the
 * heard text against it.
 */
export function loopedWer(
  script: string,
  heard: string,
  recordedSeconds: number,
  loopSeconds: number,
): {
  readonly loops: number;
  readonly referenceWords: number;
  readonly hypothesisWords: number;
  readonly wer: number;
} {
  const once = words(script);
  const loops = Math.max(1, Math.round(recordedSeconds / loopSeconds));
  const reference = Array.from({ length: loops }, () => once).flat();
  const hypothesis = words(heard);
  const errors = wordDistance(reference, hypothesis);
  return {
    loops,
    referenceWords: reference.length,
    hypothesisWords: hypothesis.length,
    wer: Math.round((errors / reference.length) * 1000) / 1000,
  };
}
