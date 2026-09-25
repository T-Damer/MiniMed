import type { MedicalDocumentSummary } from '@localmed/contracts';

import { getAssessmentCatalog } from '@/features/assessments/assessment-catalog';
import { assessmentPath } from '@/features/assessments/assessment-routing';
import { getCalculatorRegistry } from '@/features/calculators/calculator-registry';
import type { AvailableCalculatorDefinition } from '@/features/calculators/calculator-types';
import { buildOfficialDocumentHash } from '@/state/document-route';
import { loadPatientNotes } from '@/state/patient-notes';

/** App objects a note can point to, shared by `@` mentions and drawing link cards. */
export type NoteLinkKind = 'document' | 'calculator' | 'assessment' | 'note';

export const NOTE_LINK_KIND_LABEL: Readonly<Record<NoteLinkKind, string>> = {
  document: 'Документ',
  calculator: 'Калькулятор',
  assessment: 'Тест',
  note: 'Заметка',
};

export interface NoteLinkTarget {
  readonly kind: NoteLinkKind;
  readonly key: string;
  readonly title: string;
  readonly detail?: string;
  /** Hash route inside MiniMed, always starting with `#/`. */
  readonly route: string;
  readonly priority?: boolean;
}

interface NamedEntry {
  readonly title: string;
  readonly shortTitle?: string;
  readonly aliases?: readonly string[];
}

export interface NoteLinkSources {
  readonly documents: readonly Pick<MedicalDocumentSummary, 'id' | 'title'>[];
  readonly priorityDocumentIds: ReadonlySet<string>;
  readonly calculators: readonly (NamedEntry & { readonly id: string; readonly slug: string })[];
  readonly assessments: readonly (NamedEntry & {
    readonly id: string;
    readonly bankId: string;
    readonly slug: string;
  })[];
  readonly notes: readonly {
    readonly id: string;
    readonly cardId: string;
    readonly title: string;
    readonly text: string;
    readonly updatedAt: string;
  }[];
  readonly cardTitles: ReadonlyMap<string, string>;
}

export function sanitizeLinkLabel(value: string): string {
  return value.replaceAll('[', '').replaceAll(']', '').trim();
}

export function normalizeRu(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
}

export function noteTitle(text: string): string {
  const line = text
    .split('\n')
    .map((candidate) => candidate.replace(/^#+\s*|^[-*+]\s*|[*_`>]/gu, '').trim())
    .find(Boolean);
  return (line ?? '').slice(0, 60) || 'Заметка';
}

/** A MiniMed hash route. Excludes protocol-relative and scheme URLs by construction. */
export function isAppRoute(value: string): boolean {
  return /^#\/[^\s]*$/u.test(value) && value.length <= 2048;
}

export function noteLinkMarkdown(target: NoteLinkTarget): string {
  return `[${sanitizeLinkLabel(target.title) || NOTE_LINK_KIND_LABEL[target.kind]}](${target.route})`;
}

/** Up to `limit` targets matching `query`, interleaving kinds so one kind cannot crowd out others. */
export function findNoteLinkTargets(
  sources: NoteLinkSources,
  query: string,
  limit: number,
): readonly NoteLinkTarget[] {
  const needle = normalizeRu(query.trim());
  const matches = (...fields: readonly (string | undefined)[]): boolean =>
    needle.length === 0 ||
    fields.some((field) => field !== undefined && normalizeRu(field).includes(needle));
  const byTitle = (left: { title: string }, right: { title: string }): number =>
    left.title.localeCompare(right.title, 'ru-RU');

  const documents = [...sources.documents]
    .toSorted((left, right) => {
      const leftPriority = sources.priorityDocumentIds.has(left.id);
      const rightPriority = sources.priorityDocumentIds.has(right.id);
      if (leftPriority !== rightPriority) return leftPriority ? -1 : 1;
      return byTitle(left, right);
    })
    .filter((document) => matches(document.title))
    .map(
      (document): NoteLinkTarget => ({
        kind: 'document',
        key: `document:${document.id}`,
        title: document.title,
        priority: sources.priorityDocumentIds.has(document.id),
        route: buildOfficialDocumentHash(document.id),
      }),
    );

  const calculators = sources.calculators
    .filter((entry) => matches(entry.title, entry.shortTitle, ...(entry.aliases ?? [])))
    .toSorted(byTitle)
    .map(
      (entry): NoteLinkTarget => ({
        kind: 'calculator',
        key: `calculator:${entry.id}`,
        title: entry.title,
        route: `#/calculators/${encodeURIComponent(entry.slug)}`,
      }),
    );

  const assessments = sources.assessments
    .filter((entry) => matches(entry.title, entry.shortTitle, ...(entry.aliases ?? [])))
    .toSorted(byTitle)
    .map(
      (entry): NoteLinkTarget => ({
        kind: 'assessment',
        key: `assessment:${entry.id}`,
        title: entry.title,
        route: assessmentPath(entry.bankId, entry.slug),
      }),
    );

  const notes = sources.notes
    .filter((note) => matches(note.title, noteTitle(note.text), note.text))
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 20)
    .map((note): NoteLinkTarget => {
      const title = note.title.trim() || noteTitle(note.text);
      const cardTitle = sources.cardTitles.get(note.cardId);
      return {
        kind: 'note',
        key: `note:${note.id}`,
        title,
        ...(cardTitle ? { detail: cardTitle } : {}),
        route: `#/notes/${encodeURIComponent(note.cardId)}/records/${encodeURIComponent(note.id)}`,
      };
    });

  const buckets = [documents, calculators, assessments, notes];
  const mixed: NoteLinkTarget[] = [];
  for (let index = 0; mixed.length < limit; index += 1) {
    let added = false;
    for (const bucket of buckets) {
      const candidate = bucket[index];
      if (!candidate) continue;
      mixed.push(candidate);
      added = true;
      if (mixed.length >= limit) break;
    }
    if (!added) break;
  }
  return mixed;
}

/** Reads the installed catalogs and personal notes at call time. */
export function loadNoteLinkSources(
  documents: readonly Pick<MedicalDocumentSummary, 'id' | 'title'>[],
  priorityDocumentIds: readonly string[] = [],
): NoteLinkSources {
  const snapshot = loadPatientNotes();
  return {
    documents,
    priorityDocumentIds: new Set(priorityDocumentIds),
    calculators: getCalculatorRegistry().filter(
      (calculator): calculator is AvailableCalculatorDefinition => calculator.state === 'available',
    ),
    assessments: getAssessmentCatalog(),
    notes: snapshot.notes,
    cardTitles: new Map(snapshot.cards.map((card) => [card.id, card.title])),
  };
}
