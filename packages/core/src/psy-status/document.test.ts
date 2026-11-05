import { describe, expect, it } from 'vitest';

import { PSY_STATUS_CATALOG } from './catalog';
import {
  addPsyStatusCustomEntry,
  editPsyStatusEntry,
  emptyPsyStatusDocument,
  generatePsyStatusText,
  psyStatusIssues,
  togglePsyStatusPhrase,
  withPsyStatusAssessment,
} from './document';

describe('psy-status catalog', () => {
  it('carries the constructor 1.0.0 catalog whole', () => {
    expect(PSY_STATUS_CATALOG.modules.map((module) => module.sections.length)).toEqual([12, 6, 5]);
    const codes = PSY_STATUS_CATALOG.modules.flatMap((module) =>
      module.sections.flatMap((section) => section.phrases.map((phrase) => phrase.code)),
    );
    expect(codes).toHaveLength(127);
    expect(new Set(codes).size).toBe(codes.length);
    expect(PSY_STATUS_CATALOG.conflicts).toHaveLength(17);
    for (const rule of PSY_STATUS_CATALOG.conflicts) {
      expect(codes).toContain(rule.a);
      expect(codes).toContain(rule.b);
    }
  });
});

describe('psy-status text', () => {
  let document = emptyPsyStatusDocument();
  document = togglePsyStatusPhrase(document, 'orientation-full', 'a');
  document = togglePsyStatusPhrase(document, 'mood-depressed', 'b');
  document = addPsyStatusCustomEntry(document, {
    id: 'c',
    moduleId: 'mental',
    sectionId: 'emotion',
    text: 'Плачет при упоминании работы',
    evidence: 'observed',
  });
  document = withPsyStatusAssessment(document, 'mental', 'speech', 'confirmed');

  it('writes sections in catalog order at the standard level', () => {
    expect(generatePsyStatusText(document)).toBe(
      [
        'ПСИХИЧЕСКИЙ СТАТУС',
        'Сознание и ориентировка: сознание ясное; ориентирован во времени, месте, собственной личности и ситуации.',
        '',
        'Эмоции и аффект: настроение устойчиво снижено; аффект депрессивный, реактивность ограничена. Плачет при упоминании работы.',
      ].join('\n'),
    );
  });

  it('adds section statuses only at the detailed level', () => {
    expect(generatePsyStatusText(document, 'detailed')).toContain('Речь: Норма подтверждена.');
    expect(generatePsyStatusText(document, 'brief')).not.toContain('Речь');
  });

  it('removes a phrase picked twice and keeps edits', () => {
    const edited = editPsyStatusEntry(document, 'b', 'Настроение снижено');
    expect(generatePsyStatusText(edited)).toContain('Эмоции и аффект: настроение снижено.');
    const removed = togglePsyStatusPhrase(document, 'mood-depressed', 'x');
    expect(removed.entries.map((entry) => entry.id)).toEqual(['a', 'c']);
  });

  it('names contradictions and missing companions', () => {
    let conflicting = togglePsyStatusPhrase(document, 'orientation-impaired', 'd');
    conflicting = togglePsyStatusPhrase(conflicting, 'suicide-active', 'e');
    const issues = psyStatusIssues(conflicting);
    expect(issues).toContainEqual({
      type: 'strict',
      text: 'Одновременно выбраны полная ориентировка и дезориентировка.',
    });
    expect(issues.some((issue) => issue.type === 'data')).toBe(true);
    expect(psyStatusIssues(emptyPsyStatusDocument())).toEqual([]);
  });
});
