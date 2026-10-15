import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const vault = vi.hoisted(() => {
  class LockedError extends Error {}
  return {
    LockedError,
    unlocked: false,
    blobs: new Map<string, { mimeType: string; bytes: Uint8Array; patientId?: string }>(),
  };
});

vi.mock('@/state/patient-vault', () => ({
  PATIENT_VAULT_LOCK_EVENT: 'minimed:patient-vault-locked',
  PatientVaultLockedError: vault.LockedError,
  isPatientVaultUnlocked: () => vault.unlocked,
  openPatientVaultSilently: async () => vault.unlocked,
  updatePatientVault: async () => undefined,
  // The real seal is covered with the vault; here a sealed copy is a tagged plain string.
  sealPatientVaultText: async (type: string, id: string, text: string) => {
    if (!vault.unlocked) throw new vault.LockedError();
    return { plain: `${type}|${id}|${text}` };
  },
  openPatientVaultText: async (type: string, id: string, sealed: { plain: string }) => {
    if (!vault.unlocked) throw new vault.LockedError();
    return sealed.plain.slice(`${type}|${id}|`.length);
  },
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
  type FormDraftTarget,
  formDraftBlobId,
  formDraftCopies,
  formDraftCopyOwner,
  loadFormDraft,
  parseFormDraft,
  pruneFormDraftCopies,
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

describe('form draft write-ahead copy', () => {
  let storage: Map<string, string>;
  const copyKey = (): string => formDraftCopies.storageKey;
  const writeCopy = async (
    copy: FormDraft,
    copyTarget: FormDraftTarget = target,
  ): Promise<void> => {
    const owner = formDraftCopyOwner(copyTarget);
    await formDraftCopies.write(
      owner.patientId,
      owner.targetId,
      serializeFormDraft(copy),
      () => true,
    );
  };

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal('window', {
      addEventListener: () => undefined,
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
    });
    vault.unlocked = true;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('restores the last keystrokes a reload left in the copy and moves them into the vault', async () => {
    await storeFormDraft(target, draft);
    const typed: FormDraft = {
      ...draft,
      edits: { ...draft.edits, formNumber: '17-новый' },
      updatedAt: '2026-10-08T10:00:01.000Z',
    };
    await writeCopy(typed);
    clearFormSessions();

    expect(await loadFormDraft(target)).toEqual(typed);
    const stored = vault.blobs.get(formDraftBlobId(target));
    expect(parseFormDraft(new TextDecoder().decode(stored?.bytes))).toEqual(typed);
    expect(storage.has(copyKey())).toBe(false);
  });

  it('restores a copy when the vault holds no draft at all', async () => {
    await writeCopy(draft);
    expect(await loadFormDraft(target)).toEqual(draft);
    expect(vault.blobs.has(formDraftBlobId(target))).toBe(true);
  });

  it('keeps the vault draft when the copy is older, and drops the stale copy', async () => {
    const newer: FormDraft = { ...draft, updatedAt: '2026-10-08T11:00:00.000Z' };
    await storeFormDraft(target, newer);
    await writeCopy(draft);
    clearFormSessions();
    expect(await loadFormDraft(target)).toEqual(newer);
    expect(storage.has(copyKey())).toBe(false);
  });

  it('restores the copy of a blank form with no patient', async () => {
    const blank = { formId: target.formId };
    await writeCopy(draft, blank);
    expect(await loadFormDraft(blank)).toEqual(draft);
  });

  it('drops a copy nothing can read, without text in the log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const owner = formDraftCopyOwner(target);
    await formDraftCopies.write(owner.patientId, owner.targetId, 'секретный текст', () => true);
    expect(await loadFormDraft(target)).toBeUndefined();
    expect(storage.has(copyKey())).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('секретный');
    warn.mockRestore();
  });

  it('leaves a copy alone while the vault is closed', async () => {
    await writeCopy(draft);
    vault.unlocked = false;
    expect(await loadFormDraft(target)).toBeUndefined();
    expect(storage.has(copyKey())).toBe(true);
  });

  it('forgets the copies of deleted patients and keeps blank-form ones', async () => {
    await writeCopy(draft);
    await writeCopy(draft, { formId: 'f2', patientId: 'gone' });
    await writeCopy(draft, { formId: 'f3' });
    pruneFormDraftCopies(new Set(['p1']));
    const kept = Object.values(
      JSON.parse(storage.get(copyKey()) ?? '{}') as Record<string, { patientId: string }>,
    )
      .map((entry) => entry.patientId)
      .toSorted();
    expect(kept).toEqual(['', 'p1']);
  });
});
