import { createDebouncedSaver, DEFAULT_SAVE_DELAY_MS } from '@/state/debounced-saver';
import {
  type PatientVaultSnapshot,
  recordVisitNote as recordVisitNoteInSnapshot,
} from '@/state/patient-domain';
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
 * Autosave of the visit note typed in a patient card. Two layers, so no typed character is lost:
 *
 * - a write-ahead copy, sealed with the vault key (plain only in a deliberately plain vault) and
 *   written to localStorage within milliseconds of every keystroke;
 * - the durable vault write after the typing pauses, flushed when the page is hidden or unloaded.
 *
 * The copy is removed once the durable write of the newest text lands. A copy that survives a
 * reload or a locked vault is applied by `recoverVisitNotes` when the vault is open again. Only
 * opaque ids sit beside the sealed text; the clinical text never reaches storage in plain form.
 */
export const VISIT_NOTE_WRITE_AHEAD_KEY = 'minimed.patient-visit-note-ahead.v1';
const WRITE_AHEAD_TYPE = 'visit-note-ahead';
const NEW_VISIT_DELAY_MS = 2500;

interface WriteAheadEntry {
  readonly patientId: string;
  readonly episodeId: string | null;
  readonly savedAt: string;
  readonly sealed: SealedPatientText;
}

function entryId(patientId: string, episodeId: string | null): string {
  return `${patientId}|${episodeId ?? 'new'}`;
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

function isEntry(value: unknown): value is WriteAheadEntry {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['patientId'] === 'string' &&
    (candidate['episodeId'] === null || typeof candidate['episodeId'] === 'string') &&
    typeof candidate['savedAt'] === 'string' &&
    isSealed(candidate['sealed'])
  );
}

function readEntries(): Record<string, WriteAheadEntry> {
  try {
    const raw = window.localStorage.getItem(VISIT_NOTE_WRITE_AHEAD_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => isEntry(value)),
    ) as Record<string, WriteAheadEntry>;
  } catch {
    return {};
  }
}

function writeEntries(entries: Record<string, WriteAheadEntry>): void {
  try {
    if (Object.keys(entries).length === 0)
      window.localStorage.removeItem(VISIT_NOTE_WRITE_AHEAD_KEY);
    else window.localStorage.setItem(VISIT_NOTE_WRITE_AHEAD_KEY, JSON.stringify(entries));
  } catch (cause) {
    // Storage full or blocked: the durable vault write still runs, only the extra copy is missing.
    console.warn(
      'Visit note write-ahead copy not stored:',
      cause instanceof Error ? cause.message : 'storage error',
    );
  }
}

/** Copies a live autosave of this page still owns: they are newer than anything to recover. */
const ownedEntryIds = new Set<string>();

export function hasVisitNoteWriteAhead(): boolean {
  return Object.keys(readEntries()).length > 0;
}

async function sealIntoWriteAhead(
  patientId: string,
  episodeId: string | null,
  text: string,
  stillNewest: () => boolean,
): Promise<void> {
  const id = entryId(patientId, episodeId);
  const sealed = await sealPatientVaultText(WRITE_AHEAD_TYPE, id, text);
  // Sealing is asynchronous: a copy overtaken by a newer keystroke or a landed save is stale.
  if (!stillNewest()) return;
  writeEntries({
    ...readEntries(),
    [id]: { patientId, episodeId, savedAt: new Date().toISOString(), sealed },
  });
}

function removeEntries(ids: Iterable<string>): void {
  const entries = readEntries();
  let changed = false;
  for (const id of ids) {
    if (!(id in entries)) continue;
    delete entries[id];
    changed = true;
  }
  if (changed) writeEntries(entries);
}

/**
 * Applies write-ahead copies left by an earlier session (a reload before the durable write, a
 * vault locked at that moment) to the open vault and removes them. Resolves with the new snapshot,
 * or `undefined` when there was nothing to apply or the vault is locked.
 */
export async function recoverVisitNotes(): Promise<PatientVaultSnapshot | undefined> {
  const entries = Object.fromEntries(
    Object.entries(readEntries()).filter(([id]) => !ownedEntryIds.has(id)),
  );
  const ids = Object.keys(entries);
  if (ids.length === 0 || !isPatientVaultUnlocked()) return undefined;
  const recovered: { readonly entry: WriteAheadEntry; readonly text: string }[] = [];
  for (const id of ids.toSorted((a, b) =>
    (entries[a]?.savedAt ?? '').localeCompare(entries[b]?.savedAt ?? ''),
  )) {
    const entry = entries[id];
    if (!entry) continue;
    try {
      recovered.push({
        entry,
        text: await openPatientVaultText(WRITE_AHEAD_TYPE, id, entry.sealed),
      });
    } catch (cause) {
      if (cause instanceof PatientVaultLockedError) return undefined;
      // Sealed with a key this vault no longer has (the vault was replaced): nothing can read it.
      console.warn('Visit note write-ahead copy dropped: it cannot be decrypted.');
    }
  }
  const snapshot = await updatePatientVault((current) => {
    let next = current;
    for (const { entry, text } of recovered) {
      if (!next.profiles.some((profile) => profile.id === entry.patientId)) continue;
      const known = next.episodes.find((episode) => episode.id === entry.episodeId);
      // The visit was closed after the text was typed: the closing flushed everything older.
      if (known && known.status !== 'open') continue;
      next = recordVisitNoteInSnapshot(next, {
        patientId: entry.patientId,
        ...(entry.episodeId ? { episodeId: entry.episodeId } : {}),
        text,
        at: entry.savedAt,
      }).snapshot;
    }
    return next;
  });
  // A keystroke typed while this ran has rewritten its entry: only the entries applied go.
  const now = readEntries();
  removeEntries(ids.filter((id) => now[id]?.savedAt === entries[id]?.savedAt));
  return snapshot;
}

async function ensureVaultOpen(): Promise<void> {
  if (isPatientVaultUnlocked()) return;
  if (!(await openPatientVaultSilently())) throw new PatientVaultLockedError();
}

/** Stores the visit note and the explicit «Создать осмотр» (one open visit per patient). */
export async function saveVisitNote(input: {
  readonly patientId: string;
  readonly episodeId?: string;
  readonly text: string;
  readonly create?: boolean;
}): Promise<PatientVaultSnapshot> {
  await ensureVaultOpen();
  return updatePatientVault(
    (current) =>
      recordVisitNoteInSnapshot(current, {
        patientId: input.patientId,
        ...(input.episodeId ? { episodeId: input.episodeId } : {}),
        text: input.text,
        ...(input.create ? { create: true } : {}),
      }).snapshot,
  );
}

export interface VisitNoteSaverOptions {
  readonly patientId: string;
  /** The open visit the field shows, read when a change is recorded and when it is saved. */
  readonly episodeId: () => string | undefined;
  readonly onSnapshot: (snapshot: PatientVaultSnapshot) => void;
  readonly onError: (error: unknown) => void;
  readonly onPendingChange?: (pending: boolean) => void;
  /** Idle time before saving into an open visit. */
  readonly delayMs?: number;
  /** Idle time before a note typed with no open visit becomes one (tapping «Создать осмотр» is quicker). */
  readonly newVisitDelayMs?: number;
}

export interface VisitNoteSaver {
  readonly edit: (text: string) => void;
  /** Saves now; resolves `true` when everything typed is in the vault. */
  readonly flush: () => Promise<boolean>;
  readonly pending: () => boolean;
  readonly dispose: () => void;
}

export function createVisitNoteSaver(options: VisitNoteSaverOptions): VisitNoteSaver {
  let latestVersion = 0;
  let savedVersion = 0;
  const writtenIds = new Set<string>();
  let disposed = false;
  const saver = createDebouncedSaver<string>({
    delayMs: () =>
      options.episodeId()
        ? (options.delayMs ?? DEFAULT_SAVE_DELAY_MS)
        : (options.newVisitDelayMs ?? NEW_VISIT_DELAY_MS),
    onError: (cause) => {
      // A card left because the vault was locked: the sealed copy keeps the text for the next open.
      if (disposed && cause instanceof PatientVaultLockedError) return;
      options.onError(cause);
    },
    ...(options.onPendingChange ? { onPendingChange: options.onPendingChange } : {}),
    writeAhead: (text, version) => {
      latestVersion = version;
      const episodeId = options.episodeId() ?? null;
      const id = entryId(options.patientId, episodeId);
      writtenIds.add(id);
      ownedEntryIds.add(id);
      sealIntoWriteAhead(
        options.patientId,
        episodeId,
        text,
        () => version === latestVersion && version > savedVersion,
      ).catch((cause: unknown) => {
        // A locked vault cannot seal; the durable save reports the same failure to the person.
        if (!(cause instanceof PatientVaultLockedError)) options.onError(cause);
      });
    },
    save: async (text) => {
      // A closed card must not reopen a vault the person just locked.
      if (disposed && !isPatientVaultUnlocked()) throw new PatientVaultLockedError();
      const episodeId = options.episodeId();
      options.onSnapshot(
        await saveVisitNote({
          patientId: options.patientId,
          ...(episodeId ? { episodeId } : {}),
          text,
        }),
      );
    },
    onSaved: (_text, version) => {
      savedVersion = version;
      removeEntries(writtenIds);
      for (const id of writtenIds) ownedEntryIds.delete(id);
      writtenIds.clear();
    },
  });
  return {
    edit: saver.schedule,
    flush: saver.flush,
    pending: saver.pending,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      // A copy left unsaved belongs to nobody now: the next recovery applies it.
      for (const id of writtenIds) ownedEntryIds.delete(id);
      saver.dispose();
    },
  };
}
