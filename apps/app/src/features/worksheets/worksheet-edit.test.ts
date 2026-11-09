import { describe, expect, it } from 'vitest';

import {
  addWorksheetField,
  addWorksheetSection,
  addWorksheetVariant,
  moveWorksheetField,
  optionsFromText,
  removeWorksheetVariant,
  setWorksheetFieldType,
  updateWorksheetField,
} from '@/features/worksheets/worksheet-edit';
import { createUserWorksheetDraft, parseUserWorksheet } from '@/state/user-worksheet-format';

const draft = createUserWorksheetDraft('2026-11-08T00:00:00.000Z');

describe('worksheet edits', () => {
  it('adds fields with free ids and keeps the sheet valid', () => {
    const next = addWorksheetField(addWorksheetField(draft));
    expect(next.fields.map((field) => field.id)).toEqual(['f1', 'f2', 'f3']);
    expect(() => parseUserWorksheet(next)).not.toThrow();
  });

  it('moves a field within bounds only', () => {
    const next = addWorksheetField(draft);
    expect(moveWorksheetField(next, 'f2', -1).fields.map((field) => field.id)).toEqual([
      'f2',
      'f1',
    ]);
    expect(moveWorksheetField(next, 'f1', -1).fields.map((field) => field.id)).toEqual([
      'f1',
      'f2',
    ]);
  });

  it('keeps only what still applies when the type changes', () => {
    const charted = updateWorksheetField(setWorksheetFieldType(draft, 'f1', 'number'), 'f1', {
      chart: true,
      unit: 'кг',
    });
    const text = setWorksheetFieldType(charted, 'f1', 'text');
    expect(text.fields[0]).not.toHaveProperty('chart');
    expect(text.fields[0]).not.toHaveProperty('unit');
    const choice = setWorksheetFieldType(draft, 'f1', 'choice');
    expect(choice.fields[0]?.options).toEqual(['да', 'нет']);
    expect(() => parseUserWorksheet(choice)).not.toThrow();
    const scale = setWorksheetFieldType(
      updateWorksheetField(setWorksheetFieldType(draft, 'f1', 'percent'), 'f1', { chart: true }),
      'f1',
      'scale',
    );
    expect(scale.fields[0]?.chart).toBe(true);
    expect(setWorksheetFieldType(choice, 'f1', 'text').fields[0]).not.toHaveProperty('options');
  });

  it('reads options one per line', () => {
    expect(optionsFromText(' да \n\nнет\n частично ')).toEqual(['да', 'нет', 'частично']);
  });

  it('adds a section that makes a material valid', () => {
    const material = addWorksheetSection({ ...draft, layout: 'material', fields: [] });
    expect(() => parseUserWorksheet(material)).not.toThrow();
  });

  it('chooses the first variant left when the chosen one is removed', () => {
    const two = addWorksheetVariant(addWorksheetVariant(draft));
    expect(two.variant).toBe('v1');
    expect(removeWorksheetVariant(two, 'v1').variant).toBe('v2');
    expect(removeWorksheetVariant(removeWorksheetVariant(two, 'v1'), 'v2')).not.toHaveProperty(
      'variant',
    );
  });
});
