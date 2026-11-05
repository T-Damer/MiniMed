import type { AppGlyphName } from '@/components/AppGlyph';
import { assessmentPath } from '@/features/assessments/assessment-routing';
import { notesFormsPath, notesPsyStatusPath } from '@/features/notes/notes-routing';

/**
 * Forms a finished conversation can fill (FORMFILL1), as the recording dialog offers them. Declared
 * data: the dialog renders the list and never branches on an entry. `handOff` entries open the form
 * with the transcript handed to its «Беседа» sheet; the psychiatric status has its own screen that
 * takes the recording id.
 */
export interface ConversationFormEntry {
  /** The form's schema id (tool id, official form id) or `psy-status`. */
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly glyph: AppGlyphName;
  readonly handOff: boolean;
  route(recordingId: string): string;
}

export const CONVERSATION_FORMS: readonly ConversationFormEntry[] = [
  {
    id: 'psy-status',
    title: 'Психический статус',
    subtitle: 'Фразы статуса по словам беседы',
    glyph: 'brain',
    handOff: false,
    route: (recordingId) => notesPsyStatusPath(recordingId),
  },
  {
    id: 'minimed.calculator.cha2ds2-vasc',
    title: 'CHA₂DS₂-VASc',
    subtitle: 'Риск инсульта при фибрилляции предсердий',
    glyph: 'math-operations',
    handOff: true,
    route: () => `#/calculators/${encodeURIComponent('cha2ds2-vasc-stroke-risk')}`,
  },
  {
    id: 'minimed.assessment.phq-9',
    title: 'PHQ-9',
    subtitle: 'Депрессивные симптомы за 2 недели',
    glyph: 'list-numbers',
    handOff: true,
    route: () => assessmentPath('psychiatry', 'phq-9'),
  },
  {
    id: 'ru.minzdrav.274n.070u',
    title: 'Форма № 070/у',
    subtitle: 'Справка на санаторно-курортное лечение',
    glyph: 'file-text',
    handOff: true,
    route: () => notesFormsPath('ru.minzdrav.274n.070u'),
  },
];
