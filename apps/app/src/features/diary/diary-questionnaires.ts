/**
 * Self-report questionnaires a doctor can put into a care diary. Only scales the patient fills
 * in themselves (clinician-rated ones such as HAM-D stay with the doctor), and only scales whose
 * rights notice in the psychology pack allows reproduction. The definitions come from the same
 * pack the app's assessments use and are loaded on first use.
 */
import type { ToolDefinitionRecord } from '@localmed/contracts';
import { assessmentDefinitionFromRecord } from '@/features/assessments/assessment-definition';
import type { AssessmentDefinition } from '@/features/assessments/assessment-types';

export interface DiaryQuestionnaireOption {
  readonly slug: string;
  /** Short name on the patient's button and in the doctor's chips. */
  readonly title: string;
  /** What it measures, in plain words. */
  readonly about: string;
}

export const DIARY_QUESTIONNAIRES: readonly DiaryQuestionnaireOption[] = [
  { slug: 'phq-9', title: 'PHQ-9', about: 'настроение' },
  { slug: 'gad-7', title: 'GAD-7', about: 'тревога' },
  { slug: 'zung-self-rating-depression', title: 'Шкала Цунга', about: 'депрессия' },
  { slug: 'zung-self-rating-anxiety', title: 'Шкала Цунга', about: 'тревога' },
];

export function diaryQuestionnaire(slug: string): DiaryQuestionnaireOption | undefined {
  return DIARY_QUESTIONNAIRES.find((option) => option.slug === slug);
}

/** Checkpoint ids stay within the diary's 24-character id pattern. */
export function questionnaireCheckpointId(slug: string): string {
  return `q-${slug}`.slice(0, 24);
}

const loaded = new Map<string, Promise<AssessmentDefinition>>();

export function loadDiaryQuestionnaire(slug: string): Promise<AssessmentDefinition> {
  const cached = loaded.get(slug);
  if (cached) return cached;
  const promise = import('../../../../../content/tool-modules/psychology.json').then((pack) => {
    if (!diaryQuestionnaire(slug)) throw new Error('Этот опросник не входит в дневник.');
    const tools = (pack.default as { readonly tools: readonly ToolDefinitionRecord[] }).tools;
    const record = tools.find((tool) => tool.slug === slug);
    if (!record) throw new Error('Опросник не найден.');
    return assessmentDefinitionFromRecord(record);
  });
  loaded.set(slug, promise);
  promise.catch(() => loaded.delete(slug));
  return promise;
}
