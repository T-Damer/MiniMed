import { describe, expect, it } from 'vitest';

import { formDraftStateText } from '@/features/forms/form-draft-state';

describe('quiet state line of a form', () => {
  it('calls an autosaved form a draft', () => {
    expect(formDraftStateText({ status: 'draft' })).toBe('Черновик');
    expect(formDraftStateText({ status: 'draft', savedAt: '2026-10-08T10:00:00Z' })).toBe(
      'Черновик',
    );
  });

  it('says when the form was approved', () => {
    expect(formDraftStateText({ status: 'saved', savedAt: '2026-10-08T10:00:00Z' })).toMatch(
      /^Сохранено · 8 окт\.?,? \d{2}:\d{2}$/u,
    );
    expect(formDraftStateText({ status: 'saved' })).toBe('Сохранено');
    expect(formDraftStateText({ status: 'saved', savedAt: 'not a date' })).toBe('Сохранено');
  });

  it('puts a save problem before everything else', () => {
    expect(formDraftStateText({ status: 'saved', error: 'Хранилище закрыто.' })).toBe(
      'Хранилище закрыто.',
    );
  });
});
