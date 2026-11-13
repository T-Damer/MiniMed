import { AUTOMATIC_TRANSCRIPT_LABEL } from '@/features/asr/visit-recording';
import type { TranscriptSegment } from '@/features/conversations/live-transcription';
import {
  addPatientBlob,
  createPatientVault,
  deletePatientBlob,
  encryptPatientVault,
  isEncryptedPatientVaultMode,
  isPatientVaultUnlocked,
  PatientVaultLockedError,
  patientVaultStorageMode,
  readPatientBlob,
  unlockPatientVault,
} from '@/state/patient-vault';
import {
  isNativePatientVaultKeychainAvailable,
  isPatientVaultNativePlatform,
} from '@/state/patient-vault-native';

/**
 * The text of a conversation recording lives only in the patient vault's encrypted file store,
 * next to the audio it came from: a draft without a patient while recording, the patient's own
 * file once the recording is added to a card. Nothing is written to localStorage, IndexedDB
 * outside the vault, or logs.
 */
const KIND = 'minimed-conversation-transcript';
/** 2 (REC1): timed segments. 1: plain lines, still read (text made before REC1 stays readable). */
const VERSION = 2;
const MIME_TYPE = 'application/json';

export const TRANSCRIPT_SAVE_DELAY_MS = 1_500;
export const TRANSCRIPT_SAVE_MAX_WAIT_MS = 10_000;
export const TRANSCRIPT_SAVE_RETRY_MS = 15_000;

export function transcriptBlobId(recordingId: string): string {
  return `conversation-transcript-${recordingId}`;
}

export function encodeTranscript(
  recordingId: string,
  segments: readonly TranscriptSegment[],
  savedAt: Date = new Date(),
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      kind: KIND,
      version: VERSION,
      recordingId,
      savedAt: savedAt.toISOString(),
      segments,
    }),
  );
}

function isSegment(value: unknown): value is TranscriptSegment {
  if (typeof value !== 'object' || value === null) return false;
  const segment = value as { text?: unknown; startMs?: unknown; endMs?: unknown };
  const time = (field: unknown): boolean =>
    field === undefined || (typeof field === 'number' && Number.isFinite(field) && field >= 0);
  return typeof segment.text === 'string' && time(segment.startMs) && time(segment.endMs);
}

/** Reads a stored transcript; anything that is not exactly a stored shape is rejected. */
export function decodeTranscript(bytes: Uint8Array): readonly TranscriptSegment[] {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('Текст беседы повреждён.');
  }
  const record = value as {
    kind?: unknown;
    version?: unknown;
    lines?: unknown;
    segments?: unknown;
  } | null;
  if (record?.kind !== KIND) throw new Error('Текст беседы повреждён.');
  if (
    record.version === 1 &&
    Array.isArray(record.lines) &&
    record.lines.every((line) => typeof line === 'string')
  ) {
    return (record.lines as readonly string[]).map((text) => ({ text }));
  }
  if (
    record.version === VERSION &&
    Array.isArray(record.segments) &&
    record.segments.every(isSegment)
  ) {
    return record.segments as readonly TranscriptSegment[];
  }
  throw new Error('Текст беседы повреждён.');
}

export function transcriptLines(segments: readonly TranscriptSegment[]): readonly string[] {
  return segments.map((segment) => segment.text);
}

/** The note a patient's card shows: the machine label first, then the text. */
export function transcriptEventText(segments: readonly TranscriptSegment[]): string {
  return `${AUTOMATIC_TRANSCRIPT_LABEL}\n\n${transcriptLines(segments).join('\n')}`;
}

export type VaultAccess = 'encrypted' | 'unavailable';

let opening: Promise<VaultAccess> | undefined;

async function openVault(): Promise<VaultAccess> {
  const mode = await patientVaultStorageMode();
  if (isEncryptedPatientVaultMode(mode)) {
    if (!isPatientVaultUnlocked()) await unlockPatientVault();
    return 'encrypted';
  }
  // First use on a phone: the device key is created silently, exactly as the patients screen does.
  if (
    mode === undefined &&
    isPatientVaultNativePlatform() &&
    (await isNativePatientVaultKeychainAvailable())
  ) {
    await createPatientVault();
    return 'encrypted';
  }
  return 'unavailable';
}

/**
 * Opens the vault for drafts only when its files are encrypted by a device key, without asking
 * the doctor anything. A browser without a vault, or with a plaintext one, stays closed: creating
 * or encrypting it is the doctor's tap on the recording window's suggestion
 * (`enableEncryptedVault`), not something a recording may start by itself.
 */
export function openEncryptedVault(): Promise<VaultAccess> {
  opening ??= openVault().finally(() => {
    opening = undefined;
  });
  return opening;
}

/** What the recording window offers when the text cannot be saved. */
export type VaultOffer = 'create' | 'encrypt';

/** `create`: no vault exists yet; `encrypt`: a plaintext browser vault can be encrypted in place. */
export async function vaultOffer(): Promise<VaultOffer | undefined> {
  const mode = await patientVaultStorageMode();
  if (mode === undefined) return 'create';
  return mode === 'unencrypted' ? 'encrypt' : undefined;
}

/**
 * The doctor's tap on the offer: creates the encrypted vault (device key on a phone, browser key
 * elsewhere), encrypts an existing plaintext one in place, or just opens an encrypted one.
 */
export async function enableEncryptedVault(): Promise<void> {
  // A draft write that is opening the vault right now finishes first, so nothing is created twice.
  await opening?.catch(() => undefined);
  const mode = await patientVaultStorageMode();
  if (mode === undefined) await createPatientVault();
  else if (mode === 'unencrypted') await encryptPatientVault();
  else if (!isPatientVaultUnlocked()) await unlockPatientVault();
}

export type DraftSaveResult = 'saved' | 'unavailable';

/** Writes the draft transcript of a recording that has no patient yet. */
export async function saveDraftTranscript(
  recordingId: string,
  segments: readonly TranscriptSegment[],
): Promise<DraftSaveResult> {
  if ((await openEncryptedVault()) === 'unavailable') return 'unavailable';
  const write = (): Promise<void> =>
    addPatientBlob({
      id: transcriptBlobId(recordingId),
      mimeType: MIME_TYPE,
      bytes: encodeTranscript(recordingId, segments),
    });
  try {
    await write();
  } catch (cause) {
    // A write that raced with another unlock finds the session closed once; open and repeat it.
    if (!(cause instanceof PatientVaultLockedError)) throw cause;
    if ((await openEncryptedVault()) === 'unavailable') return 'unavailable';
    await write();
  }
  return 'saved';
}

/** Moves the transcript into the patient's own files, so deleting the patient deletes it too. */
export async function filePatientTranscript(
  recordingId: string,
  segments: readonly TranscriptSegment[],
  patientId: string,
): Promise<void> {
  await addPatientBlob({
    id: transcriptBlobId(recordingId),
    patientId,
    mimeType: MIME_TYPE,
    bytes: encodeTranscript(recordingId, segments),
  });
}

export type StoredTranscript =
  | { readonly status: 'found'; readonly segments: readonly TranscriptSegment[] }
  | { readonly status: 'none' }
  /** The vault is closed and cannot be opened without the doctor. */
  | { readonly status: 'locked' };

export async function readConversationTranscript(recordingId: string): Promise<StoredTranscript> {
  if (!isPatientVaultUnlocked() && (await openEncryptedVault()) === 'unavailable') {
    return { status: 'locked' };
  }
  const stored = await readPatientBlob(transcriptBlobId(recordingId));
  return stored
    ? { status: 'found', segments: decodeTranscript(stored.bytes) }
    : { status: 'none' };
}

/** Removes the transcript with its recording. A closed vault that cannot open leaves it as is. */
export async function deleteConversationTranscript(recordingId: string): Promise<void> {
  if (!isPatientVaultUnlocked() && (await openEncryptedVault()) === 'unavailable') return;
  await deletePatientBlob(transcriptBlobId(recordingId));
}

/** `unsaved`: no encrypted vault is available, the text only exists on screen. */
export type TranscriptSaveState = 'idle' | 'pending' | 'saved' | 'unsaved' | 'failed';

export interface TranscriptSaver {
  /** Notes new text; the write happens after a quiet moment (and at the latest after a wait). */
  update(segments: readonly TranscriptSegment[]): void;
  /** Writes what is pending right now. */
  flush(): Promise<void>;
  /** Writes the latest text again even if the last write reported it as not saved. */
  retry(): Promise<void>;
  /** Drops pending work, for a recording that was abandoned. */
  cancel(): void;
}

export function createTranscriptSaver(deps: {
  readonly save: (segments: readonly TranscriptSegment[]) => Promise<DraftSaveResult>;
  readonly onState: (state: TranscriptSaveState) => void;
  readonly delayMs?: number;
  readonly maxWaitMs?: number;
  readonly retryMs?: number;
}): TranscriptSaver {
  let latest: readonly TranscriptSegment[] = [];
  let dirty = false;
  let touched = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waitingSince = 0;
  let chain: Promise<void> = Promise.resolve();

  const clear = (): void => {
    clearTimeout(timer);
    timer = undefined;
  };

  const write = (): Promise<void> => {
    chain = chain.then(async () => {
      if (!dirty) return;
      const segments = latest;
      dirty = false;
      try {
        const result = await deps.save(segments);
        if (!dirty) deps.onState(result === 'saved' ? 'saved' : 'unsaved');
      } catch {
        // The cause may name the vault or the text; the doctor sees the state, the next try repeats.
        dirty = true;
        deps.onState('failed');
        schedule(deps.retryMs ?? TRANSCRIPT_SAVE_RETRY_MS);
      }
    });
    return chain;
  };

  const schedule = (delayMs: number): void => {
    clear();
    timer = setTimeout(() => {
      timer = undefined;
      waitingSince = 0;
      void write();
    }, delayMs);
  };

  return {
    update(segments) {
      latest = segments;
      touched = true;
      dirty = true;
      deps.onState('pending');
      const now = Date.now();
      if (waitingSince === 0) waitingSince = now;
      const remaining = Math.max(
        0,
        waitingSince + (deps.maxWaitMs ?? TRANSCRIPT_SAVE_MAX_WAIT_MS) - now,
      );
      schedule(Math.min(deps.delayMs ?? TRANSCRIPT_SAVE_DELAY_MS, remaining));
    },
    flush() {
      clear();
      waitingSince = 0;
      return write();
    },
    retry() {
      clear();
      waitingSince = 0;
      dirty = touched;
      return write();
    },
    cancel() {
      clear();
      waitingSince = 0;
      dirty = false;
    },
  };
}
