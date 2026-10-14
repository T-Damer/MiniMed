import { DEFAULT_SAVE_DELAY_MS } from '@/state/debounced-saver';
import {
  createDraftAutosave,
  createDraftWriteAheadStore,
  ensureVaultOpen,
} from '@/state/draft-write-ahead';
import {
  type PatientVaultSnapshot,
  recordVisitNote as recordVisitNoteInSnapshot,
} from '@/state/patient-domain';
import { updatePatientVault } from '@/state/patient-vault';

/**
 * Autosave of the visit note typed in a patient card: a sealed write-ahead copy plus the debounced
 * vault write (`draft-write-ahead.ts` holds the shared machinery). The copy is removed once the
 * durable write of the newest text lands; one that survives a reload or a locked vault is applied
 * by `recoverVisitNotes` when the vault is open again.
 */
export const VISIT_NOTE_WRITE_AHEAD_KEY = 'minimed.patient-visit-note-ahead.v1';
const NEW_VISIT_DELAY_MS = 2500;

export const visitNoteDrafts = createDraftWriteAheadStore({
  storageKey: VISIT_NOTE_WRITE_AHEAD_KEY,
  sealType: 'visit-note-ahead',
  label: 'Visit note',
});

export function hasVisitNoteWriteAhead(): boolean {
  return visitNoteDrafts.has();
}

/**
 * Applies write-ahead copies left by an earlier session (a reload before the durable write, a
 * vault locked at that moment) to the open vault and removes them. Resolves with the new snapshot,
 * or `undefined` when there was nothing to apply or the vault is locked.
 */
export function recoverVisitNotes(): Promise<PatientVaultSnapshot | undefined> {
  return visitNoteDrafts.recover((snapshot, copy) => {
    if (!snapshot.profiles.some((profile) => profile.id === copy.patientId)) return { snapshot };
    const known = snapshot.episodes.find((episode) => episode.id === copy.targetId);
    // The visit was closed after the text was typed: the closing flushed everything older.
    if (known && known.status !== 'open') return { snapshot };
    return {
      snapshot: recordVisitNoteInSnapshot(snapshot, {
        patientId: copy.patientId,
        ...(copy.targetId ? { episodeId: copy.targetId } : {}),
        text: copy.text,
        at: copy.savedAt,
      }).snapshot,
    };
  });
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
  return createDraftAutosave<string>({
    store: visitNoteDrafts,
    patientId: options.patientId,
    target: options.episodeId,
    serialize: (text) => text,
    delayMs: () =>
      options.episodeId()
        ? (options.delayMs ?? DEFAULT_SAVE_DELAY_MS)
        : (options.newVisitDelayMs ?? NEW_VISIT_DELAY_MS),
    onError: options.onError,
    ...(options.onPendingChange ? { onPendingChange: options.onPendingChange } : {}),
    save: async (text, episodeId) => {
      options.onSnapshot(
        await saveVisitNote({
          patientId: options.patientId,
          ...(episodeId ? { episodeId } : {}),
          text,
        }),
      );
      return { complete: true };
    },
  });
}
