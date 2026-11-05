import type {
  PsyStatusAssessment,
  PsyStatusEvidence,
  PsyStatusModuleId,
} from '@localmed/contracts';

import data from './catalog.ru.json';

/**
 * The phrase catalog and quality rules of the friend's offline «Конструктор психиатрического
 * статуса» 1.0.0, converted as is (texts, codes, evidence kinds, conflict and prompt rules) — see
 * `NOTICE.md` next to this file. Phrase codes are the stable ids: documents and transcript cues
 * refer to phrases by code only.
 */

export interface PsyStatusPhrase {
  readonly code: string;
  readonly text: string;
  readonly tags: readonly string[];
  readonly evidence: Exclude<PsyStatusEvidence, 'custom'>;
}

export interface PsyStatusSection {
  readonly id: string;
  readonly name: string;
  readonly hint: string;
  readonly phrases: readonly PsyStatusPhrase[];
}

export interface PsyStatusModule {
  readonly id: PsyStatusModuleId;
  readonly name: string;
  readonly sections: readonly PsyStatusSection[];
}

export interface PsyStatusConflictRule {
  readonly a: string;
  readonly b: string;
  readonly type: 'strict' | 'potential';
  readonly message: string;
}

/** When phrase `when` is picked, one of `needs` (a phrase code or a section id) should be too. */
export interface PsyStatusPromptRule {
  readonly when: string;
  readonly needs: readonly string[];
  readonly message: string;
}

export interface PsyStatusCatalog {
  readonly source: { readonly name: string; readonly version: string };
  readonly modules: readonly PsyStatusModule[];
  readonly assessmentLabels: Readonly<Record<PsyStatusAssessment, string>>;
  readonly evidenceLabels: Readonly<Record<PsyStatusEvidence, string>>;
  readonly conflicts: readonly PsyStatusConflictRule[];
  readonly prompts: readonly PsyStatusPromptRule[];
}

export const PSY_STATUS_CATALOG = data as unknown as PsyStatusCatalog;

export interface PsyStatusPhraseRef {
  readonly module: PsyStatusModule;
  readonly section: PsyStatusSection;
  readonly phrase: PsyStatusPhrase;
}

const phraseIndex = new Map<string, PsyStatusPhraseRef>();
for (const module of PSY_STATUS_CATALOG.modules) {
  for (const section of module.sections) {
    for (const phrase of section.phrases) phraseIndex.set(phrase.code, { module, section, phrase });
  }
}

export function psyStatusPhrase(code: string): PsyStatusPhraseRef | undefined {
  return phraseIndex.get(code);
}

export function psyStatusSection(
  moduleId: PsyStatusModuleId,
  sectionId: string,
): PsyStatusSection | undefined {
  return PSY_STATUS_CATALOG.modules
    .find((module) => module.id === moduleId)
    ?.sections.find((section) => section.id === sectionId);
}

export function psyStatusAssessmentKey(moduleId: PsyStatusModuleId, sectionId: string): string {
  return `${moduleId}.${sectionId}`;
}
