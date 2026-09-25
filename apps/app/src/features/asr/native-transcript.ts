import type { TranscriptionSpeakerSegment } from '@localmed/contracts';

export interface TranscriptTurn {
  readonly speakerId: string;
  readonly speakerLabel: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

const DEFAULT_MERGE_GAP_MS = 1_200;

function cleanTranscriptText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function defaultSpeakerLabels(
  segments: readonly TranscriptionSpeakerSegment[],
): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const segment of segments) {
    if (!labels.has(segment.speakerId)) {
      labels.set(segment.speakerId, `Спикер ${labels.size + 1}`);
    }
  }
  return labels;
}

export function mergeSpeakerSegments(
  segments: readonly TranscriptionSpeakerSegment[],
  options: {
    readonly maxGapMs?: number;
    readonly speakerNames?: Readonly<Record<string, string>>;
  } = {},
): readonly TranscriptTurn[] {
  const maxGapMs = options.maxGapMs ?? DEFAULT_MERGE_GAP_MS;
  if (!Number.isFinite(maxGapMs) || maxGapMs < 0) {
    throw new Error('Speaker merge gap must be a non-negative number.');
  }
  const labels = defaultSpeakerLabels(segments);
  const turns: TranscriptTurn[] = [];

  for (const segment of segments) {
    const text = cleanTranscriptText(segment.text);
    if (!text) continue;
    const speakerLabel =
      options.speakerNames?.[segment.speakerId]?.trim() ||
      labels.get(segment.speakerId) ||
      segment.speakerId;
    const previous = turns.at(-1);
    const gapMs = previous ? segment.startMs - previous.endMs : Number.POSITIVE_INFINITY;
    if (
      previous &&
      previous.speakerId === segment.speakerId &&
      gapMs <= maxGapMs &&
      segment.startMs >= previous.startMs
    ) {
      turns[turns.length - 1] = {
        ...previous,
        endMs: Math.max(previous.endMs, segment.endMs),
        text: `${previous.text} ${text}`,
      };
      continue;
    }
    turns.push({
      speakerId: segment.speakerId,
      speakerLabel,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text,
    });
  }

  return turns;
}

function timestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const body = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${body}` : body;
}

export function formatSpeakerTranscript(turns: readonly TranscriptTurn[]): string {
  return turns
    .map(
      (turn) =>
        `[${timestamp(turn.startMs)}–${timestamp(turn.endMs)}] ${turn.speakerLabel}: ${turn.text}`,
    )
    .join('\n\n');
}
