/**
 * The rows of «Сравнение препаратов» that come from the SAFE1 extraction (CMP1): minimum age and
 * weight, pregnancy, breastfeeding. The extraction runs on the instruction that is open in the
 * column (`safetyOfDocument`), so the sentences are the same as in the drug screen and the search
 * card, with the same section labels and «Открыть в инструкции» anchors. No verdict is worded:
 * the sentences are quoted, the numbers the instruction prints are listed as it prints them.
 */
import type { MedicalDocument } from '@localmed/contracts';

import { safetyOfDocument } from '@/features/medication-safety/safety-document';
import type { SafetyIntent } from '@/features/medication-safety/safety-query';
import {
  type DocumentState,
  type IntentView,
  intentView,
  type QuoteView,
} from '@/features/medication-safety/safety-view';
import type { ColumnView } from './comparison-view';

export interface SafetyRowSpec {
  readonly id: SafetyIntent;
  readonly title: string;
}

export const SAFETY_ROWS: readonly SafetyRowSpec[] = [
  { id: 'age', title: 'Возраст и масса тела' },
  { id: 'pregnancy', title: 'Беременность' },
  { id: 'lactation', title: 'Грудное вскармливание' },
];

/** Quotes shown per cell; the rest are one click away in the instruction itself. */
export const MAX_SAFETY_QUOTES = 4;

export interface SafetyCell {
  /** `ready`: the instruction was read; `nothing-said`: it was read and says nothing on the topic. */
  readonly state: 'not-read' | 'ready' | 'nothing-said';
  readonly documentId: string | null;
  readonly quotes: readonly QuoteView[];
  /** Sentences found but not shown. */
  readonly hidden: number;
  /** The age and weight words of the instruction, as it prints them (age row only). */
  readonly numbers: readonly string[];
}

export interface SafetyRowView {
  readonly id: SafetyIntent;
  readonly title: string;
  /** One cell per column. */
  readonly cells: readonly SafetyCell[];
}

const NOT_READ: SafetyCell = {
  state: 'not-read',
  documentId: null,
  quotes: [],
  hidden: 0,
  numbers: [],
};

/** Restrictions first, then the dosing and other mentions: what a doctor looks for in an age row. */
function ageQuotes(view: IntentView): readonly QuoteView[] {
  const order = ['restrictions', 'dosage', 'other'];
  return order.flatMap((id) => view.groups.find((group) => group.id === id)?.quotes ?? []);
}

function pregnancyQuotes(view: IntentView): readonly QuoteView[] {
  const order = ['section', 'warnings', 'other'];
  return order.flatMap((id) => view.groups.find((group) => group.id === id)?.quotes ?? []);
}

function numbersOf(quotes: readonly QuoteView[]): readonly string[] {
  const seen = new Set<string>();
  const numbers: string[] = [];
  for (const quote of quotes) {
    for (const text of [
      ...quote.limitWords.map((word) => word.trim()),
      ...quote.weightLimits.map((word) => `масса тела ${word}`),
      ...quote.categories,
    ]) {
      if (text === '' || seen.has(text)) continue;
      seen.add(text);
      numbers.push(text);
    }
  }
  return numbers;
}

function cellOf(
  document: MedicalDocument,
  safety: ReturnType<typeof safetyOfDocument>,
  intent: SafetyIntent,
): SafetyCell {
  if (!safety) return { ...NOT_READ, state: 'nothing-said', documentId: document.id };
  const view = intentView({
    index: safety.index,
    candidate: safety.candidate,
    intent,
    age: null,
    trimester: null,
    documents: new Map<string, DocumentState>([[document.id, { document }]]),
  });
  const all = intent === 'age' ? ageQuotes(view) : pregnancyQuotes(view);
  if (all.length === 0) {
    return { ...NOT_READ, state: 'nothing-said', documentId: document.id };
  }
  return {
    state: 'ready',
    documentId: document.id,
    quotes: all.slice(0, MAX_SAFETY_QUOTES),
    hidden: Math.max(0, all.length - MAX_SAFETY_QUOTES),
    numbers: intent === 'age' ? numbersOf(all) : [],
  };
}

export function safetyRowViews(
  columns: readonly ColumnView[],
  documents: ReadonlyMap<number, MedicalDocument>,
): readonly SafetyRowView[] {
  // The extraction runs once per instruction, whatever the number of rows.
  const safety = new Map<number, ReturnType<typeof safetyOfDocument>>();
  for (const column of columns) {
    const document = documents.get(column.position);
    if (column.state === 'ready' && document)
      safety.set(column.position, safetyOfDocument(document));
  }
  return SAFETY_ROWS.map((spec) => ({
    id: spec.id,
    title: spec.title,
    cells: columns.map((column) => {
      const document = documents.get(column.position);
      return column.state === 'ready' && document
        ? cellOf(document, safety.get(column.position) ?? null, spec.id)
        : NOT_READ;
    }),
  }));
}
