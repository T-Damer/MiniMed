import { createDebouncedSaver, DEFAULT_SAVE_DELAY_MS } from '@/state/debounced-saver';
import type { PatientVaultSnapshot } from '@/state/patient-domain';
import {
  isPatientVaultUnlocked,
  openPatientVaultSilently,
  openPatientVaultText,
  PatientVaultLockedError,
  type SealedPatientText,
  sealPatientVaultText,
  updatePatientVault,
} from '@/state/patient-vault';

/**
 * Typed text that belongs to a patient card (a visit note, the form-data panel, a visit diagnosis)
 * is an autosaved draft with two layers, so no typed character is lost:
 *
 * - a write-ahead copy, sealed with the vault key (plain only in a deliberately plain vault) and
 *   written to localStorage within milliseconds of every change;
 * - the durable vault write after the typing pauses, flushed when the page is hidden or unloaded.
 *
 * A copy is removed once the durable write of the newest text landed *completely*. A draft that
 * cannot be applied as typed (an ICD-10 code or SNILS in the wrong format) is saved as far as it is
 * valid, the invalid part stays in the copy, and the editor shows it back with its inline error
 * (`read`): validation never blocks a draft. A copy left by an earlier session (a reload before
 * the durable write, a vault locked at that moment) is applied by `recover` when the vault is open.
 * Only opaque ids sit beside the sealed text; the clinical text never reaches storage in plain form.
 */
export interface DraftCopy {
  readonly patientId: string;
  /** The record the draft belongs to (a visit id), or `null` for a draft with no record yet. */
  readonly targetId: string | null;
  readonly savedAt: string;
  readonly text: string;
}

interface StoredCopy {
  readonly patientId: string;
  readonly targetId: string | null;
  readonly savedAt: string;
  readonly sealed: SealedPatientText;
}

/** What applying a recovered copy to the vault did: `keep` leaves the copy for the editor. */
export interface DraftRecovery {
  readonly snapshot: PatientVaultSnapshot;
  readonly keep?: boolean;
}

export interface DraftWriteAheadStore {
  readonly storageKey: string;
  readonly entryId: (patientId: string, targetId: string | null) => string;
  readonly has: () => boolean;
  /** Stores a sealed copy unless `stillNewest` says a newer change or a landed save overtook it. */
  readonly write: (
    patientId: string,
    targetId: string | null,
    text: string,
    stillNewest: () => boolean,
  ) => Promise<void>;
  readonly remove: (ids: Iterable<string>) => void;
  /** Marks a copy as owned by a live autosave of this page: recovery leaves it alone. */
  readonly own: (id: string) => void;
  readonly release: (id: string) => void;
  /** The stored copy of one draft, when there is one and the vault can open it. */
  readonly read: (patientId: string, targetId: string | null) => Promise<DraftCopy | undefined>;
  /**
   * Applies the copies of earlier sessions to the open vault. Resolves with the snapshot, or
   * `undefined` when there was nothing to apply or the vault is locked.
   */
  readonly recover: (
    apply: (snapshot: PatientVaultSnapshot, copy: DraftCopy) => DraftRecovery,
  ) => Promise<PatientVaultSnapshot | undefined>;
}

function isSealed(value: unknown): value is SealedPatientText {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['plain'] === 'string' ||
    (typeof candidate['iv'] === 'string' &&
      typeof candidate['aad'] === 'string' &&
      typeof candidate['ciphertext'] === 'string')
  );
}

function isStoredCopy(value: unknown): value is StoredCopy {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['patientId'] === 'string' &&
    (candidate['targetId'] === null || typeof candidate['targetId'] === 'string') &&
    typeof candidate['savedAt'] === 'string' &&
    isSealed(candidate['sealed'])
  );
}

export function createDraftWriteAheadStore(options: {
  /** localStorage key of the copies. */
  readonly storageKey: string;
  /** Authenticated-encryption purpose label, so a copy cannot be opened as another kind. */
  readonly sealType: string;
  /** Names the draft in log lines. */
  readonly label: string;
}): DraftWriteAheadStore {
  const { storageKey, sealType, label } = options;
  /** Copies a live autosave of this page still owns: they are newer than anything to recover. */
  const owned = new Set<string>();

  const entryId = (patientId: string, targetId: string | null): string =>
    `${patientId}|${targetId ?? 'new'}`;

  const readEntries = (): Record<string, StoredCopy> => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => isStoredCopy(value)),
      ) as Record<string, StoredCopy>;
    } catch {
      return {};
    }
  };

  const writeEntries = (entries: Record<string, StoredCopy>): void => {
    try {
      if (Object.keys(entries).length === 0) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, JSON.stringify(entries));
    } catch (cause) {
      // Storage full or blocked: the durable vault write still runs, only the extra copy is missing.
      console.warn(
        `${label} write-ahead copy not stored:`,
        cause instanceof Error ? cause.message : 'storage error',
      );
    }
  };

  const remove = (ids: Iterable<string>): void => {
    const entries = readEntries();
    let changed = false;
    for (const id of ids) {
      if (!(id in entries)) continue;
      delete entries[id];
      changed = true;
    }
    if (changed) writeEntries(entries);
  };

  const open = async (id: string, entry: StoredCopy): Promise<DraftCopy | null> => {
    try {
      return {
        patientId: entry.patientId,
        targetId: entry.targetId,
        savedAt: entry.savedAt,
        text: await openPatientVaultText(sealType, id, entry.sealed),
      };
    } catch (cause) {
      if (cause instanceof PatientVaultLockedError) throw cause;
      // Sealed with a key this vault no longer has (the vault was replaced): nothing can read it.
      console.warn(`${label} write-ahead copy dropped: it cannot be decrypted.`);
      return null;
    }
  };

  return {
    storageKey,
    entryId,
    has: () => Object.keys(readEntries()).length > 0,
    write: async (patientId, targetId, text, stillNewest) => {
      const id = entryId(patientId, targetId);
      const sealed = await sealPatientVaultText(sealType, id, text);
      // Sealing is asynchronous: a copy overtaken by a newer change or a landed save is stale.
      if (!stillNewest()) return;
      writeEntries({
        ...readEntries(),
        [id]: { patientId, targetId, savedAt: new Date().toISOString(), sealed },
      });
    },
    remove,
    own: (id) => void owned.add(id),
    release: (id) => void owned.delete(id),
    read: async (patientId, targetId) => {
      if (!isPatientVaultUnlocked()) return undefined;
      const id = entryId(patientId, targetId);
      const entry = readEntries()[id];
      if (!entry) return undefined;
      try {
        return (await open(id, entry)) ?? undefined;
      } catch (cause) {
        if (cause instanceof PatientVaultLockedError) return undefined;
        throw cause;
      }
    },
    recover: async (apply) => {
      const entries = Object.fromEntries(
        Object.entries(readEntries()).filter(([id]) => !owned.has(id)),
      );
      const ids = Object.keys(entries);
      if (ids.length === 0 || !isPatientVaultUnlocked()) return undefined;
      const copies: { readonly id: string; readonly copy: DraftCopy }[] = [];
      for (const id of ids.toSorted((a, b) =>
        (entries[a]?.savedAt ?? '').localeCompare(entries[b]?.savedAt ?? ''),
      )) {
        const entry = entries[id];
        if (!entry) continue;
        try {
          const copy = await open(id, entry);
          if (copy) copies.push({ id, copy });
        } catch {
          // Locked while reading: leave every copy for the next open.
          return undefined;
        }
      }
      const kept = new Set<string>();
      const snapshot = await updatePatientVault((current) => {
        let next = current;
        for (const { id, copy } of copies) {
          try {
            const result = apply(next, copy);
            next = result.snapshot;
            if (result.keep) kept.add(id);
          } catch (cause) {
            // One copy the vault refuses must not hold back the others: it stays for the editor.
            kept.add(id);
            console.warn(
              `${label} write-ahead copy kept:`,
              cause instanceof Error ? cause.message : 'not applicable',
            );
          }
        }
        return next;
      });
      // A change typed while this ran has rewritten its entry: only the entries applied go.
      const now = readEntries();
      remove(ids.filter((id) => !kept.has(id) && now[id]?.savedAt === entries[id]?.savedAt));
      return snapshot;
    },
  };
}

/** Outcome of one durable save: `complete` is false when part of the draft could not be applied. */
export interface DraftSaveResult {
  readonly complete: boolean;
}

export interface DraftAutosaveOptions<T> {
  readonly store: DraftWriteAheadStore;
  readonly patientId: string;
  /** The record the draft is bound to, read when a change is made and kept with that change. */
  readonly target: () => string | undefined;
  readonly serialize: (value: T) => string;
  readonly save: (value: T, target: string | undefined) => Promise<DraftSaveResult>;
  readonly onError: (error: unknown) => void;
  readonly onPendingChange?: (pending: boolean) => void;
  /** Idle time before the durable save, read at every change. */
  readonly delayMs?: number | (() => number);
}

export interface DraftAutosave<T> {
  readonly edit: (value: T) => void;
  /** Saves now; resolves `true` when everything typed is in the vault or in its draft copy. */
  readonly flush: () => Promise<boolean>;
  readonly pending: () => boolean;
  readonly dispose: () => void;
}

interface TargetedDraft<T> {
  readonly value: T;
  /** The record the value was typed into, fixed when the change is made. */
  readonly target: string | undefined;
}

/** One draft field: write-ahead copy at once, ordered debounced vault save, flush on page events. */
export function createDraftAutosave<T>(options: DraftAutosaveOptions<T>): DraftAutosave<T> {
  const { store } = options;
  let latestVersion = 0;
  let savedVersion = 0;
  let lastComplete = true;
  const writtenIds = new Set<string>();
  let disposed = false;
  const saver = createDebouncedSaver<TargetedDraft<T>>({
    delayMs: options.delayMs ?? DEFAULT_SAVE_DELAY_MS,
    onError: (cause) => {
      // A card left because the vault was locked: the sealed copy keeps the text for the next open.
      if (disposed && cause instanceof PatientVaultLockedError) return;
      options.onError(cause);
    },
    ...(options.onPendingChange ? { onPendingChange: options.onPendingChange } : {}),
    writeAhead: (draft, version) => {
      latestVersion = version;
      const target = draft.target ?? null;
      const id = store.entryId(options.patientId, target);
      writtenIds.add(id);
      store.own(id);
      store
        .write(
          options.patientId,
          target,
          options.serialize(draft.value),
          () => version === latestVersion && version > savedVersion,
        )
        .catch((cause: unknown) => {
          // A locked vault cannot seal; the durable save reports the same failure to the person.
          if (!(cause instanceof PatientVaultLockedError)) options.onError(cause);
        });
    },
    save: async (draft) => {
      // A closed card must not reopen a vault the person just locked.
      if (disposed && !isPatientVaultUnlocked()) throw new PatientVaultLockedError();
      lastComplete = (await options.save(draft.value, draft.target)).complete;
    },
    onSaved: (_draft, version) => {
      // A copy that still holds what the vault could not take stays for the editor to show back.
      if (!lastComplete) return;
      savedVersion = version;
      store.remove(writtenIds);
      for (const id of writtenIds) store.release(id);
      writtenIds.clear();
    },
  });
  return {
    edit: (value) => saver.schedule({ value, target: options.target() }),
    flush: saver.flush,
    pending: saver.pending,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      // A copy left unsaved belongs to nobody now: the next recovery applies it.
      for (const id of writtenIds) store.release(id);
      saver.dispose();
    },
  };
}

/** Opens the vault for a save that runs after the card's own session was dropped. */
export async function ensureVaultOpen(): Promise<void> {
  if (isPatientVaultUnlocked()) return;
  if (!(await openPatientVaultSilently())) throw new PatientVaultLockedError();
}

export interface CopyDraft {
  /** Records the text typed so far: the sealed copy is written at once. */
  readonly save: (text: string) => void;
  /** The copy a reload or an earlier visit to the screen left, when the vault can open it. */
  readonly read: () => Promise<string | undefined>;
  /** Removes the copy (the form was submitted or abandoned on purpose). */
  readonly discard: () => void;
}

/**
 * A draft whose only home is its sealed copy: a creation form (a new patient card) has no record
 * in the vault to write into yet. The copy stays until `discard`, so the form comes back as it was
 * left; submitting or cancelling it is the only approval.
 */
export function createCopyDraft(
  store: DraftWriteAheadStore,
  patientId: string,
  targetId: string,
  onError: (error: unknown) => void,
): CopyDraft {
  let version = 0;
  return {
    save: (text) => {
      version += 1;
      const mine = version;
      store
        .write(patientId, targetId, text, () => mine === version)
        .catch((cause: unknown) => {
          // A locked vault cannot seal; there is nothing to protect on a locked screen.
          if (!(cause instanceof PatientVaultLockedError)) onError(cause);
        });
    },
    read: async () => (await store.read(patientId, targetId))?.text,
    discard: () => {
      // A seal still running is stale from now on and never lands.
      version += 1;
      store.remove([store.entryId(patientId, targetId)]);
    },
  };
}
