import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createCopyDraft,
  createDraftAutosave,
  createDraftWriteAheadStore,
  type DraftWriteAheadStore,
} from '@/state/draft-write-ahead';
import { emptyPatientVaultSnapshot, type PatientVaultSnapshot } from '@/state/patient-domain';

const vault = vi.hoisted(() => {
  class LockedError extends Error {}
  return {
    LockedError,
    unlocked: true,
    snapshot: undefined as unknown,
  };
});

vi.mock('@/state/patient-vault', () => ({
  PatientVaultLockedError: vault.LockedError,
  isPatientVaultUnlocked: () => vault.unlocked,
  openPatientVaultSilently: async () => vault.unlocked,
  // The real seal is covered with the vault; here a sealed copy is a tagged plain string.
  sealPatientVaultText: async (type: string, id: string, text: string) => {
    if (!vault.unlocked) throw new vault.LockedError();
    return { plain: `${type}|${id}|${text}` };
  },
  openPatientVaultText: async (type: string, id: string, sealed: { plain: string }) => {
    if (!vault.unlocked) throw new vault.LockedError();
    const prefix = `${type}|${id}|`;
    if (!sealed.plain.startsWith(prefix)) throw new Error('integrity');
    return sealed.plain.slice(prefix.length);
  },
  updatePatientVault: async (
    update: (snapshot: PatientVaultSnapshot) => PatientVaultSnapshot,
  ): Promise<PatientVaultSnapshot> => {
    const current = vault.snapshot as PatientVaultSnapshot;
    const next = update(current);
    vault.snapshot = next;
    return next;
  },
}));

const KEY = 'test.draft-ahead';

describe('draft write-ahead', () => {
  let storage: Map<string, string>;
  let store: DraftWriteAheadStore;
  const saved: { value: string; target: string | undefined }[] = [];

  const stored = (): string => storage.get(KEY) ?? '';
  const until = async (condition: () => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(condition()).toBe(true);
  };
  const autosave = (options: {
    complete?: () => boolean;
    target?: () => string | undefined;
    delayMs?: number;
  }) =>
    createDraftAutosave<string>({
      store,
      patientId: 'p1',
      target: options.target ?? (() => undefined),
      serialize: (value) => value,
      delayMs: options.delayMs ?? 10,
      onError: (cause) => {
        throw cause;
      },
      save: async (value, target) => {
        saved.push({ value, target });
        return { complete: options.complete?.() ?? true };
      },
    });

  beforeEach(() => {
    storage = new Map();
    saved.length = 0;
    vault.unlocked = true;
    vault.snapshot = emptyPatientVaultSnapshot();
    const target = new EventTarget();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    });
    vi.stubGlobal('document', new EventTarget());
    store = createDraftWriteAheadStore({ storageKey: KEY, sealType: 'test-ahead', label: 'Test' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('takes the patient from a function, read when the change is made', async () => {
    let patient = 'p1';
    const draft = createDraftAutosave<string>({
      store,
      patientId: () => patient,
      target: () => 'form/e1',
      serialize: (value) => value,
      delayMs: 60_000,
      onError: (cause) => {
        throw cause;
      },
      save: async () => ({ complete: true }),
    });
    draft.edit('первый');
    await until(() => stored() !== '');
    patient = 'p2';
    await draft.flush();
    draft.edit('второй');
    await until(() => stored() !== '');
    await expect(store.read('p2', 'form/e1')).resolves.toMatchObject({ text: 'второй' });
    await expect(store.read('p1', 'form/e1')).resolves.toBeUndefined();
    draft.dispose();
  });

  it('prunes the copies of owners that are gone without opening them', async () => {
    await store.write('p1', 'a', 'один', () => true);
    await store.write('p2', null, 'два', () => true);
    await store.write('', 'b', 'три', () => true);
    vault.unlocked = false;
    store.prune((owner) => owner.patientId !== 'p2');
    vault.unlocked = true;
    await expect(store.read('p2', null)).resolves.toBeUndefined();
    await expect(store.read('p1', 'a')).resolves.toMatchObject({ text: 'один' });
    await expect(store.read('', 'b')).resolves.toMatchObject({ text: 'три' });
  });

  it('writes a copy at once and drops it when the newest value is saved completely', async () => {
    const draft = autosave({ delayMs: 60_000 });
    draft.edit('черновик');
    await until(() => stored() !== '');
    expect(draft.pending()).toBe(true);
    await expect(draft.flush()).resolves.toBe(true);
    expect(saved).toEqual([{ value: 'черновик', target: undefined }]);
    expect(stored()).toBe('');
    draft.dispose();
  });

  it('keeps the copy while the vault could not take everything, and drops it once it can', async () => {
    let complete = false;
    const draft = autosave({ complete: () => complete });
    draft.edit('J4');
    await until(() => saved.length === 1);
    // The valid part was saved; the rest lives on in the copy and is shown back after a reload.
    expect(stored()).toContain('J4');
    await expect(store.read('p1', null)).resolves.toMatchObject({ text: 'J4' });
    complete = true;
    draft.edit('J45.0');
    await draft.flush();
    expect(stored()).toBe('');
    await expect(store.read('p1', null)).resolves.toBeUndefined();
    draft.dispose();
  });

  it('still writes the copy when an incomplete save lands before the sealing finished', async () => {
    const draft = createDraftAutosave<string>({
      store,
      patientId: 'p1',
      target: () => undefined,
      serialize: (value) => value,
      delayMs: 0,
      onError: (cause) => {
        throw cause;
      },
      save: async () => ({ complete: false }),
    });
    draft.edit('Незавершённо');
    await draft.flush();
    await until(() => stored().includes('Незавершённо'));
    draft.dispose();
  });

  it('binds a change to the record it was typed into, not the one shown when it is saved', async () => {
    let target: string | undefined = 'visit-1';
    const draft = autosave({ target: () => target, delayMs: 60_000 });
    draft.edit('для первого');
    target = 'visit-2';
    await draft.flush();
    expect(saved).toEqual([{ value: 'для первого', target: 'visit-1' }]);
    draft.dispose();
  });

  it('keeps separate copies per record and reads one back', async () => {
    let target: string | undefined = 'visit-1';
    const draft = autosave({ complete: () => false, target: () => target });
    draft.edit('первый');
    await until(() => saved.length === 1);
    target = 'visit-2';
    draft.edit('второй');
    await until(() => saved.length === 2);
    await until(() => stored().includes('visit-2'));
    await expect(store.read('p1', 'visit-1')).resolves.toMatchObject({ text: 'первый' });
    await expect(store.read('p1', 'visit-2')).resolves.toMatchObject({ text: 'второй' });
    await expect(store.read('p1', 'visit-3')).resolves.toBeUndefined();
    draft.dispose();
  });

  it('reads nothing while the vault is locked', async () => {
    const draft = autosave({ delayMs: 60_000 });
    draft.edit('секрет');
    await until(() => stored() !== '');
    vault.unlocked = false;
    await expect(store.read('p1', null)).resolves.toBeUndefined();
    await expect(store.recover((snapshot) => ({ snapshot }))).resolves.toBeUndefined();
    expect(stored()).not.toBe('');
    draft.dispose();
  });

  describe('recover', () => {
    const leaveCopy = async (text: string, targetId: string | null = null): Promise<void> => {
      const draft = autosave({ delayMs: 60_000, target: () => targetId ?? undefined });
      draft.edit(text);
      await until(() => stored().includes(text));
      draft.dispose();
    };

    it('applies copies of an earlier session and removes them', async () => {
      await leaveCopy('до перезагрузки');
      const seen: string[] = [];
      const snapshot = await store.recover((current, copy) => {
        seen.push(copy.text);
        return { snapshot: { ...current, profiles: [] } };
      });
      expect(seen).toEqual(['до перезагрузки']);
      expect(snapshot).toBeDefined();
      expect(stored()).toBe('');
      await expect(store.recover((current) => ({ snapshot: current }))).resolves.toBeUndefined();
    });

    it('leaves a copy the handler wants to keep, and one a live autosave owns', async () => {
      await leaveCopy('неверный код', 'visit-1');
      await store.recover((current) => ({ snapshot: current, keep: true }));
      expect(stored()).toContain('visit-1');

      const live = autosave({ delayMs: 60_000, target: () => 'visit-2' });
      live.edit('ещё печатается');
      await until(() => stored().includes('visit-2'));
      const applied: string[] = [];
      await store.recover((current, copy) => {
        applied.push(copy.text);
        return { snapshot: current };
      });
      expect(applied).toEqual(['неверный код']);
      expect(stored()).toContain('visit-2');
      live.dispose();
    });

    it('keeps a copy the vault refuses without blocking the others', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await leaveCopy('плохая', 'visit-1');
      await leaveCopy('хорошая', 'visit-2');
      const applied: string[] = [];
      await store.recover((current, copy) => {
        if (copy.text === 'плохая') throw new Error('Осмотр не найден.');
        applied.push(copy.text);
        return { snapshot: current };
      });
      expect(applied).toEqual(['хорошая']);
      expect(stored()).toContain('visit-1');
      expect(stored()).not.toContain('visit-2');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('kept'), 'Осмотр не найден.');
      warn.mockRestore();
    });

    it('drops a copy sealed for another purpose', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      storage.set(
        KEY,
        JSON.stringify({
          'p1|new': {
            patientId: 'p1',
            targetId: null,
            savedAt: '2026-10-14T10:00:00.000Z',
            sealed: { plain: 'other|p1|new|чужое' },
          },
        }),
      );
      const applied: string[] = [];
      await store.recover((current, copy) => {
        applied.push(copy.text);
        return { snapshot: current };
      });
      expect(applied).toEqual([]);
      expect(stored()).toBe('');
      warn.mockRestore();
    });
  });

  describe('copy draft', () => {
    const errors: unknown[] = [];

    it('keeps the newest text as the only copy until it is discarded', async () => {
      const copy = createCopyDraft(store, 'new-patient', 'form', (cause) => errors.push(cause));
      copy.save('{"name":"А"}');
      copy.save('{"name":"Анна"}');
      await until(() => stored().includes('Анна'));
      await expect(copy.read()).resolves.toBe('{"name":"Анна"}');
      // A new page reads the copy back through its own handle.
      const reopened = createCopyDraft(store, 'new-patient', 'form', (cause) => errors.push(cause));
      await expect(reopened.read()).resolves.toBe('{"name":"Анна"}');
      copy.discard();
      expect(stored()).toBe('');
      await expect(copy.read()).resolves.toBeUndefined();
      expect(errors).toEqual([]);
    });

    it('does not bring a copy back when it is discarded while sealing', async () => {
      const copy = createCopyDraft(store, 'new-patient', 'form', (cause) => errors.push(cause));
      copy.save('{"name":"Анна"}');
      copy.discard();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(stored()).toBe('');
    });
  });
});
