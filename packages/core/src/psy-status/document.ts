import {
  PSY_STATUS_SCHEMA_VERSION,
  type PsyStatusAssessment,
  type PsyStatusDetail,
  type PsyStatusDocument,
  type PsyStatusEntry,
  type PsyStatusSuggestion,
} from '@localmed/contracts';

import {
  PSY_STATUS_CATALOG,
  psyStatusAssessmentKey,
  psyStatusPhrase,
  psyStatusSection,
} from './catalog';

/**
 * The psychiatric status document: what is picked, each section's status, and the text generated
 * from them. Generation and the quality check follow the friend's constructor 1.0.0: normal
 * findings are never added by themselves, a section without picked phrases is left out (its status
 * only shows at the «detailed» level), and the check names contradictions without calling the text
 * correct when it finds none.
 */

export function emptyPsyStatusDocument(): PsyStatusDocument {
  return {
    schemaVersion: PSY_STATUS_SCHEMA_VERSION,
    entries: [],
    assessments: {},
    detail: 'standard',
    dismissed: [],
  };
}

export function psyStatusAssessment(
  document: PsyStatusDocument,
  moduleId: PsyStatusEntry['moduleId'],
  sectionId: string,
): PsyStatusAssessment {
  return document.assessments[psyStatusAssessmentKey(moduleId, sectionId)] ?? 'not-assessed';
}

export function withPsyStatusAssessment(
  document: PsyStatusDocument,
  moduleId: PsyStatusEntry['moduleId'],
  sectionId: string,
  assessment: PsyStatusAssessment,
): PsyStatusDocument {
  const key = psyStatusAssessmentKey(moduleId, sectionId);
  const assessments = { ...document.assessments };
  if (assessment === 'not-assessed') delete assessments[key];
  else assessments[key] = assessment;
  return { ...document, assessments };
}

/** Adds a catalog phrase, or removes it when it is already picked. */
export function togglePsyStatusPhrase(
  document: PsyStatusDocument,
  code: string,
  id: string,
): PsyStatusDocument {
  if (document.entries.some((entry) => entry.code === code)) {
    return { ...document, entries: document.entries.filter((entry) => entry.code !== code) };
  }
  const ref = psyStatusPhrase(code);
  if (!ref) return document;
  const entry: PsyStatusEntry = {
    id,
    moduleId: ref.module.id,
    sectionId: ref.section.id,
    code,
    text: ref.phrase.text,
    evidence: ref.phrase.evidence,
    origin: 'manual',
    quotes: [],
  };
  return { ...document, entries: [...document.entries, entry] };
}

export function addPsyStatusCustomEntry(
  document: PsyStatusDocument,
  input: {
    readonly id: string;
    readonly moduleId: PsyStatusEntry['moduleId'];
    readonly sectionId: string;
    readonly text: string;
    readonly evidence: PsyStatusEntry['evidence'];
  },
): PsyStatusDocument {
  const text = input.text.trim();
  if (!text || !psyStatusSection(input.moduleId, input.sectionId)) return document;
  const entry: PsyStatusEntry = { ...input, text, origin: 'manual', quotes: [] };
  return { ...document, entries: [...document.entries, entry] };
}

/** The accepted suggestion keeps the transcript words it stands on. */
export function acceptPsyStatusSuggestion(
  document: PsyStatusDocument,
  suggestion: PsyStatusSuggestion,
  id: string,
): PsyStatusDocument {
  const ref = psyStatusPhrase(suggestion.code);
  if (!ref || document.entries.some((entry) => entry.code === suggestion.code)) return document;
  const entry: PsyStatusEntry = {
    id,
    moduleId: ref.module.id,
    sectionId: ref.section.id,
    code: suggestion.code,
    text: ref.phrase.text,
    evidence: ref.phrase.evidence,
    origin: 'transcript',
    quotes: suggestion.quotes,
  };
  return {
    ...document,
    entries: [...document.entries, entry],
    dismissed: document.dismissed.filter((code) => code !== suggestion.code),
  };
}

export function dismissPsyStatusSuggestion(
  document: PsyStatusDocument,
  code: string,
): PsyStatusDocument {
  return document.dismissed.includes(code)
    ? document
    : { ...document, dismissed: [...document.dismissed, code] };
}

/** Suggestions the doctor has not accepted or turned down yet. */
export function openPsyStatusSuggestions(
  document: PsyStatusDocument,
  suggestions: readonly PsyStatusSuggestion[],
): readonly PsyStatusSuggestion[] {
  const picked = new Set(document.entries.map((entry) => entry.code));
  const dismissed = new Set(document.dismissed);
  return suggestions.filter(
    (suggestion) => !picked.has(suggestion.code) && !dismissed.has(suggestion.code),
  );
}

export function editPsyStatusEntry(
  document: PsyStatusDocument,
  id: string,
  text: string,
): PsyStatusDocument {
  return {
    ...document,
    entries: document.entries.map((entry) => (entry.id === id ? { ...entry, text } : entry)),
  };
}

export function removePsyStatusEntry(document: PsyStatusDocument, id: string): PsyStatusDocument {
  return { ...document, entries: document.entries.filter((entry) => entry.id !== id) };
}

function sentence(value: string): string {
  const text = value.trim();
  return text && !/[.!?…]$/u.test(text) ? `${text}.` : text;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLocaleLowerCase('ru') + value.slice(1);
}

function sameText(value: string): string {
  return value.toLocaleLowerCase('ru').replace(/\s+/gu, ' ').trim();
}

/** The status text: modules in catalog order, then sections, then the picked phrases in order. */
export function generatePsyStatusText(
  document: PsyStatusDocument,
  detail: PsyStatusDetail = document.detail,
): string {
  const parts: string[] = [];
  for (const module of PSY_STATUS_CATALOG.modules) {
    const sectionParts: string[] = [];
    for (const section of module.sections) {
      const assessment = psyStatusAssessment(document, module.id, section.id);
      const assessmentText =
        assessment === 'not-assessed'
          ? ''
          : `${section.name}: ${PSY_STATUS_CATALOG.assessmentLabels[assessment]}.`;
      const entries = document.entries.filter(
        (entry) =>
          entry.moduleId === module.id && entry.sectionId === section.id && entry.text.trim(),
      );
      if (entries.length === 0) {
        if (detail === 'detailed' && assessmentText) sectionParts.push(assessmentText);
        continue;
      }
      const unique = [...new Map(entries.map((entry) => [sameText(entry.text), entry])).values()];
      let text = unique.map((entry) => sentence(entry.text)).join(' ');
      if (detail === 'detailed') {
        text = `${section.name}. ${assessmentText ? `${assessmentText} ` : ''}${text}`;
      } else if (detail === 'standard') {
        text = `${section.name}: ${lowerFirst(text)}`;
      }
      sectionParts.push(text);
    }
    if (sectionParts.length > 0) {
      parts.push(
        `${module.name.toLocaleUpperCase('ru')}\n${sectionParts.join(detail === 'brief' ? ' ' : '\n\n')}`,
      );
    }
  }
  return parts.join('\n\n');
}

export interface PsyStatusIssue {
  /** `strict`: cannot both hold; `potential`: check time or source; `data`: something is missing. */
  readonly type: 'strict' | 'potential' | 'data';
  readonly text: string;
}

/** Contradictions, duplicates and missing companions, by the constructor's transparent rules. */
export function psyStatusIssues(document: PsyStatusDocument): readonly PsyStatusIssue[] {
  const issues: PsyStatusIssue[] = [];
  const codes = new Set(document.entries.flatMap((entry) => (entry.code ? [entry.code] : [])));
  for (const rule of PSY_STATUS_CATALOG.conflicts) {
    if (codes.has(rule.a) && codes.has(rule.b))
      issues.push({ type: rule.type, text: rule.message });
  }
  const seen = new Map<string, PsyStatusEntry>();
  for (const entry of document.entries) {
    const key = sameText(entry.text);
    const first = seen.get(key);
    if (!first) {
      seen.set(key, entry);
      continue;
    }
    const a = psyStatusSection(first.moduleId, first.sectionId)?.name ?? '';
    const b = psyStatusSection(entry.moduleId, entry.sectionId)?.name ?? '';
    issues.push({
      type: 'potential',
      text: `Дублируется формулировка в разделах «${a}» и «${b}».`,
    });
  }
  for (const rule of PSY_STATUS_CATALOG.prompts) {
    if (!codes.has(rule.when)) continue;
    const met = rule.needs.some(
      (need) => codes.has(need) || document.entries.some((entry) => entry.sectionId === need),
    );
    if (!met) issues.push({ type: 'data', text: rule.message });
  }
  return issues;
}
