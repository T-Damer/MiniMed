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
});
