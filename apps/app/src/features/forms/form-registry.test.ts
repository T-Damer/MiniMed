import { describe, expect, it } from 'vitest';

import { findFormSchema, listFormSchemas } from '@/features/forms/form-registry';

describe('shipped form schemas', () => {
  it('parse against the contract and carry provenance of the official publication', () => {
    const schemas = listFormSchemas();
    expect(schemas.length).toBeGreaterThan(0);
    const form = findFormSchema('ru.minzdrav.274n.070u');
    expect(form?.formNumber).toBe('070/у');
    expect(form?.source.publicationUrl).toBe(
      'http://publication.pravo.gov.ru/document/0001202505300033',
    );
    expect(form?.source.sha256).toBe(
      'e385d12af60d1aa9a54f4e493addd10d21b764413c697d8eba43358f58a5dd3c',
    );
  });

  it('cites the governing paragraph for every defined field and none for undefined ones', () => {
    for (const form of listFormSchemas()) {
      const paragraphs = new Map(form.rules.map((rule) => [rule.id, rule]));
      for (const field of form.fields) {
        if (field.rule.status === 'undefined') expect(field.rule.paragraphIds).toEqual([]);
        for (const id of field.rule.paragraphIds) expect(paragraphs.has(id)).toBe(true);
      }
    }
  });

  it('declares every prefill in the schema: no field id is special-cased by the UI', () => {
    const form = findFormSchema('ru.minzdrav.274n.070u');
    const bound = form?.fields.filter((field) => field.prefill).map((field) => field.id) ?? [];
    expect(bound).toContain('patientFullName');
    expect(bound).toContain('attendingDoctor');
    expect(bound).not.toContain('attendingDoctorSignature');
  });

  it('ships the five forms of order 274н, all from the one official file', () => {
    const forms = listFormSchemas();
    expect(forms.map((form) => form.formNumber)).toEqual([
      '070/у',
      '072/у',
      '076/у',
      '079/у',
      '025-1/у',
    ]);
    expect(new Set(forms.map((form) => form.id)).size).toBe(forms.length);
    for (const form of forms) {
      expect(form.source.orderNumber).toBe('274н');
      expect(form.source.sha256).toBe(
        'e385d12af60d1aa9a54f4e493addd10d21b764413c697d8eba43358f58a5dd3c',
      );
      // every printed caption was located in the OCR or confirmed on the scan, and listed
      expect(form.source.extraction.blankLabelsVerified).toBeGreaterThan(0);
    }
  });

  it('keeps the route stable: the schema ids are the ones the routes and the tools link carry', () => {
    expect(listFormSchemas().map((form) => form.id)).toEqual([
      'ru.minzdrav.274n.070u',
      'ru.minzdrav.274n.072u',
      'ru.minzdrav.274n.076u',
      'ru.minzdrav.274n.079u',
      'ru.minzdrav.274n.025-1u',
    ]);
  });

  it('binds only declared paths: workplace and citizenship are used where a printed line needs them', () => {
    const talon = findFormSchema('ru.minzdrav.274n.025-1u');
    const certificate = findFormSchema('ru.minzdrav.274n.079u');
    expect(talon?.fields.find((field) => field.id === 'workplace')?.prefill?.sources).toEqual([
      'patient.workplace',
    ]);
    expect(
      certificate?.fields.find((field) => field.id === 'citizenship')?.prefill?.sources,
    ).toEqual(['patient.citizenship']);
  });

  it('describes a two-sided blank with a page break and the landscape talon with its tables', () => {
    for (const id of ['072u', '076u', '079u']) {
      const form = findFormSchema(`ru.minzdrav.274n.${id}`);
      expect(form?.layout.page.orientation).toBe('portrait');
      expect(form?.layout.blocks.some((block) => block.pageBreakBefore)).toBe(true);
    }
    const talon = findFormSchema('ru.minzdrav.274n.025-1u');
    expect(talon?.layout.page.orientation).toBe('landscape');
    expect(talon?.layout.blocks.filter((block) => block.framed).length).toBeGreaterThanOrEqual(4);
  });
});
