import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const vault = vi.hoisted(() => {
  class LockedError extends Error {}
  return {
    LockedError,
    unlocked: true,
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
  clearPrescriptionSessions,
  emptyDraft,
  isUntouchedDraft,
  loadPrescriptionDraft,
  prescriptionBlobId,
  prescriptionDraftCopies,
  prunePrescriptionDraftCopies,
  rememberPrescriptionDraft,
  storePrescriptionDraft,
} from '@/features/prescription/prescription-draft-store';
import { newItem } from '@/features/prescription/prescription-model';

const FORM = 'ru.minzdrav.107u';
const withDrug = (label: string, updatedAt: string) => ({
  ...emptyDraft(FORM),
  items: [newItem('rx-1', 'esklp.mnn.test', label)],
  updatedAt,
});

describe('prescription draft write-ahead copy', () => {
  let storage: Map<string, string>;
  const lockHandlers: (() => void)[] = [];
  const copyKey = (): string => prescriptionDraftCopies.storageKey;
  const writeCopy = (patientId: string, draft: ReturnType<typeof withDrug>) =>
    prescriptionDraftCopies.write(patientId, null, JSON.stringify(draft), () => true);

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal('window', {
      addEventListener: (name: string, handler: () => void) => {
        if (name === 'minimed:patient-vault-locked') lockHandlers.push(handler);
      },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
    });
    vault.unlocked = true;
    vault.blobs.clear();
    clearPrescriptionSessions();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes a draft without a patient to browser storage the moment it changes', () => {
    const draft = withDrug('Парацетамол', '2026-10-15T10:00:00.000Z');
    rememberPrescriptionDraft(undefined, draft);
    expect(storage.get('minimed.prescription.draft')).toContain('Парацетамол');
    rememberPrescriptionDraft(undefined, emptyDraft(FORM));
    expect(storage.has('minimed.prescription.draft')).toBe(false);
  });

  it('restores the last edits a reload left in the copy and moves them into the vault', async () => {
    const stored = withDrug('Парацетамол', '2026-10-15T10:00:00.000Z');
    await storePrescriptionDraft('p1', stored);
    const typed = withDrug('Парацетамол 500', '2026-10-15T10:00:01.000Z');
    await writeCopy('p1', typed);
    clearPrescriptionSessions();

    expect(await loadPrescriptionDraft('p1')).toEqual(typed);
    const blob = vault.blobs.get(prescriptionBlobId('p1'));
    expect(new TextDecoder().decode(blob?.bytes)).toContain('Парацетамол 500');
    expect(storage.has(copyKey())).toBe(false);
  });

  it('restores a copy when the vault holds no draft at all', async () => {
    const typed = withDrug('Ибупрофен', '2026-10-15T10:00:01.000Z');
    await writeCopy('p1', typed);
    expect(await loadPrescriptionDraft('p1')).toEqual(typed);
    expect(vault.blobs.has(prescriptionBlobId('p1'))).toBe(true);
  });

  it('keeps the vault draft when the copy is older, and drops the stale copy', async () => {
    const newer = withDrug('Новый', '2026-10-15T11:00:00.000Z');
    await storePrescriptionDraft('p1', newer);
    await writeCopy('p1', withDrug('Старый', '2026-10-15T10:00:00.000Z'));
    clearPrescriptionSessions();
    expect(await loadPrescriptionDraft('p1')).toEqual(newer);
    expect(storage.has(copyKey())).toBe(false);
  });

  it('drops a copy nothing can read, without text in the log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await prescriptionDraftCopies.write('p1', null, 'секретный текст', () => true);
    expect(await loadPrescriptionDraft('p1')).toBeUndefined();
    expect(storage.has(copyKey())).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('секретный');
    warn.mockRestore();
  });

  it('leaves a copy alone while the vault is closed', async () => {
    await writeCopy('p1', withDrug('Ибупрофен', '2026-10-15T10:00:01.000Z'));
    vault.unlocked = false;
    expect(await loadPrescriptionDraft('p1')).toBeUndefined();
    expect(storage.has(copyKey())).toBe(true);
  });

  it('drops a patient draft from memory when the vault locks, and keeps one without a patient', async () => {
    const own = withDrug('Свой', '2026-10-15T10:00:00.000Z');
    await storePrescriptionDraft('p1', own);
    await storePrescriptionDraft(undefined, withDrug('Без пациента', '2026-10-15T10:00:00.000Z'));
    for (const handler of lockHandlers) handler();
    vault.unlocked = false;
    expect(await loadPrescriptionDraft('p1')).toBeUndefined();
    expect((await loadPrescriptionDraft(undefined))?.items[0]?.label).toBe('Без пациента');
  });

  it('treats a draft with only a typed weight as a draft', () => {
    expect(isUntouchedDraft(emptyDraft(FORM))).toBe(true);
    const typed = { ...emptyDraft(FORM) };
    expect(isUntouchedDraft({ ...typed, patient: { ...typed.patient, weightKg: 18 } })).toBe(false);
  });

  it('forgets the copies of deleted patients', async () => {
    await writeCopy('p1', withDrug('А', '2026-10-15T10:00:01.000Z'));
    await writeCopy('gone', withDrug('Б', '2026-10-15T10:00:01.000Z'));
    prunePrescriptionDraftCopies(new Set(['p1']));
    const patients = Object.values(
      JSON.parse(storage.get(copyKey()) ?? '{}') as Record<string, { patientId: string }>,
    ).map((entry) => entry.patientId);
    expect(patients).toEqual(['p1']);
  });
});
