import type { TranscriptSegment } from '@/state/note-transcription';

export interface SpeakerRegion {
  readonly speakerId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly confidence?: number;
}

const DEFAULT_MERGE_GAP_MS = 1_200;
const NO_SPACE_BEFORE = /^[,.!?;:%)\]}»]/u;
const NO_SPACE_AFTER = /[([{«]$/u;

function overlapMs(
  left: Pick<TranscriptSegment, 'startMs' | 'endMs'>,
  right: Pick<SpeakerRegion, 'startMs' | 'endMs'>,
): number {
  return Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
}

function regionForWord(
  word: TranscriptSegment,
  regions: readonly SpeakerRegion[],
): SpeakerRegion | undefined {
  let best: SpeakerRegion | undefined;
  let bestOverlap = 0;
  const midpoint = word.startMs + (word.endMs - word.startMs) / 2;

  for (const region of regions) {
    if (region.endMs <= region.startMs || !region.speakerId) continue;
    const overlap = overlapMs(word, region);
    if (overlap > bestOverlap) {
      best = region;
      bestOverlap = overlap;
      continue;
    }
    if (overlap !== bestOverlap || overlap === 0 || !best) continue;

    const bestContainsMidpoint = midpoint >= best.startMs && midpoint < best.endMs;
    const candidateContainsMidpoint = midpoint >= region.startMs && midpoint < region.endMs;
    if (candidateContainsMidpoint && !bestContainsMidpoint) {
      best = region;
      continue;
    }
    if (candidateContainsMidpoint === bestContainsMidpoint && region.startMs < best.startMs) {
      best = region;
    }
  }

  return bestOverlap > 0 ? best : undefined;
}

function appendToken(current: string, token: string): string {
  const clean = token.replace(/\s+/gu, ' ').trim();
  if (!clean) return current;
  if (!current) return clean;
  if (NO_SPACE_BEFORE.test(clean) || NO_SPACE_AFTER.test(current)) return current + clean;
  return `${current} ${clean}`;
}

/**
 * Maps word-level ASR timestamps to source-backed diarization regions. A word
 * with no temporal overlap keeps its existing speaker ID instead of inventing
 * a nearest speaker.
 */
export function alignWordsToSpeakers(
  words: readonly TranscriptSegment[],
  regions: readonly SpeakerRegion[],
): readonly TranscriptSegment[] {
  return words.flatMap((word) => {
    if (word.endMs <= word.startMs || !word.text.trim()) return [];
    const region = regionForWord(word, regions);
    return [
      {
        ...word,
        ...(region ? { speakerId: region.speakerId } : {}),
        text: word.text.trim(),
      },
    ];
  });
}

/**
 * Collapses word timestamps into readable speaker turns after alignment.
 * Long pauses remain separate turns even when the same person resumes.
 */
export function mergeSpeakerWords(
  words: readonly TranscriptSegment[],
  maxGapMs = DEFAULT_MERGE_GAP_MS,
): readonly TranscriptSegment[] {
  if (!Number.isFinite(maxGapMs) || maxGapMs < 0) {
    throw new Error('Speaker merge gap must be a non-negative number.');
  }

  const turns: TranscriptSegment[] = [];
  for (const word of words) {
    if (word.endMs <= word.startMs || !word.text.trim()) continue;
    const previous = turns.at(-1);
    const gap = previous ? word.startMs - previous.endMs : Number.POSITIVE_INFINITY;
    if (previous && previous.speakerId === word.speakerId && gap >= 0 && gap <= maxGapMs) {
      turns[turns.length - 1] = {
        ...previous,
        endMs: Math.max(previous.endMs, word.endMs),
        text: appendToken(previous.text, word.text),
      };
      continue;
    }
    turns.push({ ...word, text: word.text.trim() });
  }
  return turns;
}

export function buildSpeakerTurns(
  words: readonly TranscriptSegment[],
  regions: readonly SpeakerRegion[],
  maxGapMs = DEFAULT_MERGE_GAP_MS,
): readonly TranscriptSegment[] {
  return mergeSpeakerWords(alignWordsToSpeakers(words, regions), maxGapMs);
}
export interface OptionalSpeakerTurns {
  readonly segments: readonly TranscriptSegment[];
  readonly diarized: boolean;
}

/**
 * Plain Whisper timestamps remain valid when diarization is unavailable or
 * returns no regions. Only a non-empty set of real regions may set diarized=true.
 */
export function applyOptionalSpeakerRegions(
  words: readonly TranscriptSegment[],
  regions: readonly SpeakerRegion[] | null,
  maxGapMs = DEFAULT_MERGE_GAP_MS,
): OptionalSpeakerTurns {
  if (!regions?.length) {
    return {
      segments: mergeSpeakerWords(words, maxGapMs),
      diarized: false,
    };
  }
  return {
    segments: buildSpeakerTurns(words, regions, maxGapMs),
    diarized: true,
  };
}
