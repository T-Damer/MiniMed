/**
 * New patients the doctor began and has not created yet (owner 2026-11-05): what was typed on
 * «Новый пациент» stays as a draft card at the top of the list, and the card opens the form where
 * it was left. The drafts live in memory for the page and, on the doctor's own computer, sealed
 * with this device's key (`keepNewPatientDrafts`), so a reload finds them; creating the patient or
 * discarding the draft removes it. Nothing of a draft reaches the server before it is created.
 */
import { createSignal } from 'solid-js';

import {
  type DoctorSession,
  keepNewPatientDrafts,
  readNewPatientDrafts,
} from '@/features/diary/connected/doctor-account';
import type { CareDraft } from '@/features/diary/diary-care-draft';

export interface NewPatientDraft {
  readonly id: string;
  readonly savedAt: string;
  readonly label: string;
  readonly emoji: string;
  readonly phone: string;
  readonly birthDate: string;
  readonly screen: CareDraft;
  readonly doctor: string;
  readonly note: string;
}

/** The form's fields, as the draft keeps them. */
export type NewPatientFields = Omit<NewPatientDraft, 'id' | 'savedAt'>;

interface Stored {
  readonly v: 1;
  readonly drafts: readonly NewPatientDraft[];
}

const [drafts, setDrafts] = createSignal<readonly NewPatientDraft[]>([]);
/** Whose drafts are in memory: another doctor signing in on this page starts empty. */
let owner: string | undefined;
let loading: Promise<void> | undefined;
let writing: Promise<void> | undefined;
let writeAgain = false;

/** The current doctor's drafts, the most recently edited first. */
export const newPatientDrafts = drafts;

function ownedBy(session: DoctorSession): void {
  if (owner === session.doctor.id) return;
  // The last doctor's pending write goes under their own key before the list changes hands.
  flush();
  owner = session.doctor.id;
  loading = undefined;
  setDrafts([]);
}

function sorted(list: readonly NewPatientDraft[]): readonly NewPatientDraft[] {
  return [...list].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

function parse(text: string): readonly NewPatientDraft[] {
  const stored = JSON.parse(text) as Partial<Stored>;
  if (stored.v !== 1 || !Array.isArray(stored.drafts)) return [];
  return stored.drafts.filter(
    (draft): draft is NewPatientDraft =>
      typeof draft?.id === 'string' &&
      typeof draft.savedAt === 'string' &&
      Array.isArray(draft.screen?.sections),
  );
}

/** Reads the drafts this device keeps for the doctor, once per doctor; drafts in memory win. */
export function loadNewPatientDrafts(session: DoctorSession): Promise<void> {
  ownedBy(session);
  loading ??= readNewPatientDrafts(session)
    .then((text) => {
      if (owner !== session.doctor.id || text === undefined) return;
      const kept = parse(text);
      const current = drafts();
      const known = new Set(current.map((draft) => draft.id));
      setDrafts(sorted([...current, ...kept.filter((draft) => !known.has(draft.id))]));
    })
    .catch((cause: unknown) => {
      console.warn('Дневники: черновики пациентов не открылись', cause);
    });
  return loading;
}

/** Typing pause before the drafts are sealed and written; the card in the list follows at once. */
const WRITE_DELAY_MS = 400;
let pendingFor: DoctorSession | undefined;
let writeTimer: number | undefined;

/** Seals and writes the list; changes made during a write are folded into the next one. */
function write(session: DoctorSession): void {
  if (writing) {
    writeAgain = true;
    return;
  }
  const text = JSON.stringify({ v: 1, drafts: drafts() } satisfies Stored);
  writing = keepNewPatientDrafts(session, text)
    .catch((cause: unknown) => {
      console.warn('Дневники: черновик пациента не сохранён', cause);
    })
    .finally(() => {
      writing = undefined;
      if (!writeAgain) return;
      writeAgain = false;
      if (owner === session.doctor.id) write(session);
    });
}

/** Writes what waits for the typing pause now (the page is being hidden or closed). */
function flush(): void {
  const session = pendingFor;
  if (!session) return;
  window.clearTimeout(writeTimer);
  writeTimer = undefined;
  pendingFor = undefined;
  write(session);
}

let flushHooked = false;

function persist(session: DoctorSession): void {
  if (!flushHooked) {
    flushHooked = true;
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }
  pendingFor = session;
  window.clearTimeout(writeTimer);
  writeTimer = window.setTimeout(flush, WRITE_DELAY_MS);
}

export function newPatientDraft(id: string | undefined): NewPatientDraft | undefined {
  return id ? drafts().find((draft) => draft.id === id) : undefined;
}

export function newPatientDraftId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join('');
}

/** Keeps the form's fields under `id`, at the top of the list. */
export function saveNewPatientDraft(
  session: DoctorSession,
  id: string,
  fields: NewPatientFields,
): void {
  ownedBy(session);
  const draft: NewPatientDraft = { ...fields, id, savedAt: new Date().toISOString() };
  setDrafts((list) => [draft, ...list.filter((item) => item.id !== id)]);
  persist(session);
}

/** The patient was created, or the doctor let the draft go. */
export function discardNewPatientDraft(session: DoctorSession, id: string): void {
  ownedBy(session);
  if (!drafts().some((draft) => draft.id === id)) return;
  setDrafts((list) => list.filter((item) => item.id !== id));
  persist(session);
}

/** Sign-out: the drafts leave memory too (the sealed copy goes with `signOut`). */
export function forgetNewPatientDrafts(): void {
  window.clearTimeout(writeTimer);
  writeTimer = undefined;
  pendingFor = undefined;
  owner = undefined;
  loading = undefined;
  setDrafts([]);
}

/** The draft's name in the list: the pseudonym, or what the patient's screen holds. */
export function newPatientDraftTitle(draft: NewPatientDraft): string {
  return draft.label.trim() || 'Без имени';
}
