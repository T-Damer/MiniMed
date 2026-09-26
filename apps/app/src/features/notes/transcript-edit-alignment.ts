import type { TranscriptSegment } from '@/state/note-transcription';

function normalizedTranscriptWords(value: string): string {
  return value
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function transcriptTextMatchesSegments(
  text: string,
  segments: readonly TranscriptSegment[] | undefined,
): boolean {
  if (!segments?.length) return false;
  return (
    normalizedTranscriptWords(text) ===
    normalizedTranscriptWords(segments.map((segment) => segment.text).join(' '))
  );
}
