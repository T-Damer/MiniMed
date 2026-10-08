import { beforeEach, describe, expect, it, vi } from 'vitest';

const vault = vi.hoisted(() => ({
  unlocked: false,
  blobs: new Map<string, { mimeType: string; bytes: Uint8Array; patientId?: string }>(),
}));

vi.mock('@/state/patient-vault', () => ({
  isPatientVaultUnlocked: () => vault.unlocked,
  addPatientBlob: async (input: {
    id: string;
    patientId?: string;
    mimeType: string;
    bytes: Uint8Array;
  }) => {
    vault.blobs.set(input.id, {
      mimeType: input.mimeType,
      bytes: input.bytes,
      ...(input.patientId ? { patientId: input.patientId } : {}),
    });
  },
  readPatientBlob: async (id: string) => vault.blobs.get(id),
}));

import {
  FormDraftError,
  formDraftBlobId,
  loadFormDraft,
  parseFormDraft,
  serializeFormDraft,
  storeFormDraft,
} from '@/features/forms/form-draft-store';
import {
  clearFormSessions,
  type FormDraft,
  formSessionKey,
  readFormSession,
} from '@/features/forms/form-session';

const target = { formId: 'ru.minzdrav.274n.070u', patientId: 'p1', episodeId: 'e1' };
const draft: FormDraft = {
  edits: { formNumber: '17', seasons: ['summer'], flag: true },
  status: 'draft',
  updatedAt: '2026-10-08T10:00:00.000Z',
};

beforeEach(() => {
  vault.unlocked = false;
  vault.blobs.clear();
  clearFormSessions();
});

describe('form draft file', () => {
  it('names one file per form, patient and episode', () => {
    expect(formDraftBlobId(target)).toBe('form-draft/ru.minzdrav.274n.070u/p1/e1');
    expect(formDraftBlobId({ formId: 'f' })).toBe('form-draft/f/-/-');
  });

  it('reads back what it wrote, including the approval time', () => {
    const saved: FormDraft = {
      ...draft,
      status: 'saved',
      savedAt: '2026-10-08T10:05:00.000Z',
    };
    expect(parseFormDraft(serializeFormDraft(saved))).toEqual(saved);
    expect(parseFormDraft(serializeFormDraft(draft))).toEqual(draft);
  });

  it('refuses damaged or foreign records instead of half-reading them', () => {
    for (const text of [
      'not json',
      '[]',
      JSON.stringify({ kind: 'other' }),
      JSON.stringify({ ...JSON.parse(serializeFormDraft(draft)), status: 'signed' }),
      JSON.stringify({ ...JSON.parse(serializeFormDraft(draft)), edits: { a: 5 } }),
      JSON.stringify({ ...JSON.parse(serializeFormDraft(draft)), updatedAt: 'yesterday' }),
    ]) {
      expect(() => parseFormDraft(text)).toThrow(FormDraftError);
    }
  });
});

describe('form draft storage', () => {
  it('keeps a draft in memory only while the patient vault is closed', async () => {
    await storeFormDraft({ formId: target.formId }, draft);
    expect(vault.blobs.size).toBe(0);
    expect(await loadFormDraft({ formId: target.formId })).toEqual(draft);
  });

  it('writes the draft into the vault, tied to the patient, when it is open', async () => {
    vault.unlocked = true;
    await storeFormDraft(target, draft);
    const stored = vault.blobs.get(formDraftBlobId(target));
    expect(stored).toMatchObject({ mimeType: 'application/json', patientId: 'p1' });
    expect(new TextDecoder().decode(stored?.bytes)).not.toContain('password');
  });

  it('restores a draft from the vault after memory was cleared and remembers it', async () => {
    vault.unlocked = true;
    await storeFormDraft(target, draft);
    clearFormSessions();
    const key = formSessionKey(target.formId, target.patientId, target.episodeId);
    expect(readFormSession(key)).toBeUndefined();
    expect(await loadFormDraft(target)).toEqual(draft);
    expect(readFormSession(key)).toEqual(draft);
  });

  it('finds nothing for a form that was never filled, and nothing while the vault is closed', async () => {
    expect(await loadFormDraft(target)).toBeUndefined();
    vault.unlocked = true;
    expect(await loadFormDraft(target)).toBeUndefined();
  });

  it('does not forget an approved form that has no typed values', async () => {
    const approved: FormDraft = {
      edits: {},
      status: 'saved',
      updatedAt: '2026-10-08T10:00:00.000Z',
      savedAt: '2026-10-08T10:00:00.000Z',
    };
    await storeFormDraft({ formId: 'f' }, approved);
    expect(await loadFormDraft({ formId: 'f' })).toEqual(approved);
  });

  it('forgets an untouched draft', async () => {
    await storeFormDraft({ formId: 'f' }, draft);
    await storeFormDraft({ formId: 'f' }, { ...draft, edits: {} });
    expect(await loadFormDraft({ formId: 'f' })).toBeUndefined();
  });
});
