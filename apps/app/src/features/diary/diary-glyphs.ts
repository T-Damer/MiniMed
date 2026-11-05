import type { AppGlyphName } from '@/components/AppGlyph';
import type { DiaryCheckpoint } from '@/features/diary/diary-model';

const KIND_GLYPH: Readonly<Record<DiaryCheckpoint['kind'], AppGlyphName>> = {
  score: 'smiley',
  vitals: 'heartbeat',
  text: 'note-pencil',
  choice: 'list-checks',
  use: 'drop',
  questionnaire: 'list-numbers',
};

/** Measurements told apart by their first field (owner 2026-11-04: an icon for each). */
const FIELD_GLYPH: Readonly<Partial<Record<string, AppGlyphName>>> = {
  mood: 'brain',
  weight: 'scales',
  glucose: 'drop-half',
  steps: 'sneaker-move',
  meals: 'fork-knife',
};

/** The icon of a day-screen row: by what it measures, else by its kind. */
export function checkpointGlyph(checkpoint: DiaryCheckpoint): AppGlyphName {
  const first = checkpoint.fields?.[0];
  return (first && FIELD_GLYPH[first]) || KIND_GLYPH[checkpoint.kind];
}
