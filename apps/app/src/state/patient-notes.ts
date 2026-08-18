import type { MedicalCore } from '@localmed/contracts';
import { lightStemRussian, tokenize } from '@localmed/search-lexical';

import { deleteNoteImagesForNotes } from '@/state/note-images';
import {
  personalMatchScore,
  personalQueryStems,
  wordMatchesQueryStem,
} from '@/state/personal-stem-match';

/**
 * Local patient cards and their nested notes.
 *
 * This is a personal trust layer: it never mixes with installed official content, it is never
 * published, and every surface that shows a match must label it as a personal record rather than an
 * official source.
 */
export interface PatientCard {
  readonly id: string;
  readonly title: string;
  /** Free-form context a doctor keeps at hand: age, weight, allergies, ward. */
  readonly summary: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A reminder attached to a note. Completion keeps the record instead of deleting it: what condition
 * closed a clinical follow-up is itself part of the patient's history.
 */
export interface NoteReminder {
  readonly dueAt: string;
  /** Date-only reminders are due at the start of that day. */
  readonly allDay: boolean;
  readonly notificationEnabled: boolean;
  readonly completedAt: string | null;
  /** The condition/observation the doctor recorded when closing the reminder. */
  readonly completionNote: string;
}

export interface NoteAttachedScore {
  readonly label: string;
  readonly rawScore: number;
  readonly maximumScore: number;
  readonly percent: number;
}

export interface NoteAttachedOutput {
  readonly label: string;
  readonly display: string;
}

export interface NoteAttachedAssessmentResult {
  readonly kind: 'assessment';
  readonly recordId: string;
  readonly assessmentId: string;
  readonly slug: string;
  readonly specialtyId: string;
  readonly title: string;
  readonly headline: string;
  readonly summary: string;
  readonly scores: readonly NoteAttachedScore[];
  readonly manualText?: string;
  readonly disclaimer?: string;
}

export interface NoteAttachedCalculatorResult {
  readonly kind: 'calculator';
  readonly recordId: string;
  readonly calculatorId: string;
  readonly slug: string;
  readonly title: string;
  readonly inputSummary: string;
  readonly outputs: readonly NoteAttachedOutput[];
  readonly warnings: readonly string[];
}

export type NoteAttachedResult = NoteAttachedAssessmentResult | NoteAttachedCalculatorResult;

export interface PatientNote {
  readonly id: string;
  readonly cardId: string;
  /** Notes nest inside notes, so a visit can hold its own follow-ups. */
  readonly parentNoteId: string | null;
  readonly text: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly categories: readonly string[];
  readonly relatedDocumentIds: readonly string[];
  readonly attachedResults?: readonly NoteAttachedResult[];
  readonly reminder?: NoteReminder;
}

export interface PatientNotesSnapshot {
  readonly cards: readonly PatientCard[];
  readonly notes: readonly PatientNote[];
}

export interface PatientNoteDraft {
  readonly noteId: string;
  readonly text: string;
  readonly reminderDate: string;
  readonly reminderTime: string;
  readonly savedAt: string;
}

export interface PatientNoteRevision {
  readonly noteId: string;
  readonly text: string;
  readonly savedAt: string;
}

export interface PatientNoteMatch {
  readonly card: PatientCard;
  /** Absent when the card itself matched rather than one of its notes. */
  readonly note: PatientNote | null;
  readonly score: number;
  readonly snippet: string;
}

export const PATIENT_NOTES_KEY = 'minimed.patient-notes.v1';
export const PATIENT_NOTE_DRAFTS_KEY = 'minimed.patient-note-drafts.v1';
export const PATIENT_NOTE_REVISIONS_KEY = 'minimed.patient-note-revisions.v1';
export const PATIENT_NOTES_EVENT = 'minimed:patient-notes-changed';

const MAX_SNIPPET_LENGTH = 180;
const EMPTY: PatientNotesSnapshot = { cards: [], notes: [] };
const DATABASE_NAME = 'minimed-personal-notes-v1';
const SNAPSHOT_STORE = 'snapshots';
const COLLEAGUE_NOTE_MARKER_KEY = 'minimed.colleague-note.v1';
const COLLEAGUE_CARD_ID = 'card-colleague-welcome';
const COLLEAGUE_NOTE_ID = 'note-colleague-welcome';
const COLLEAGUE_NOTE_TEXT =
  'Я сделал это приложение, чтобы тебе было удобно искать документы и записывать информацию о пациентах. Здесь же можно создавать напоминания — они появятся прямо в этом разделе. Для полноценной работы рекомендую скачать локальную ИИ-модель и всю базу знаний: так всё нужное останется под рукой, даже если пропадёт интернет.';

function isPatientNoteDraft(value: unknown): value is PatientNoteDraft {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PatientNoteDraft>;
  return (
    typeof candidate.noteId === 'string' &&
    typeof candidate.text === 'string' &&
    typeof candidate.reminderDate === 'string' &&
    typeof candidate.reminderTime === 'string' &&
    typeof candidate.savedAt === 'string'
  );
}

function isPatientNoteRevision(value: unknown): value is PatientNoteRevision {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PatientNoteRevision>;
  return (
    typeof candidate.noteId === 'string' &&
    typeof candidate.text === 'string' &&
    typeof candidate.savedAt === 'string'
  );
}

function readNoteStorage(key: string): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeNoteStorage(key: string, value: Record<string, unknown>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The main note remains available even when browser draft storage is unavailable.
  }
}

export function loadPatientNoteDraft(noteId: string): PatientNoteDraft | null {
  const value = readNoteStorage(PATIENT_NOTE_DRAFTS_KEY)[noteId];
  return isPatientNoteDraft(value) ? value : null;
}

export function savePatientNoteDraft(draft: PatientNoteDraft): void {
  if (!draft.noteId) return;
  const drafts = readNoteStorage(PATIENT_NOTE_DRAFTS_KEY);
  drafts[draft.noteId] = draft;
  writeNoteStorage(PATIENT_NOTE_DRAFTS_KEY, drafts);
}

export function removePatientNoteDraft(noteId: string): void {
  const drafts = readNoteStorage(PATIENT_NOTE_DRAFTS_KEY);
  if (!(noteId in drafts)) return;
  delete drafts[noteId];
  writeNoteStorage(PATIENT_NOTE_DRAFTS_KEY, drafts);
}

export function loadPreviousPatientNoteRevision(noteId: string): PatientNoteRevision | null {
  const value = readNoteStorage(PATIENT_NOTE_REVISIONS_KEY)[noteId];
  return isPatientNoteRevision(value) ? value : null;
}

function savePreviousPatientNoteRevision(note: PatientNote): void {
  const revisions = readNoteStorage(PATIENT_NOTE_REVISIONS_KEY);
  revisions[note.id] = {
    noteId: note.id,
    text: note.text,
    savedAt: new Date().toISOString(),
  } satisfies PatientNoteRevision;
  writeNoteStorage(PATIENT_NOTE_REVISIONS_KEY, revisions);
}

function removePatientNoteRevision(noteId: string): void {
  const revisions = readNoteStorage(PATIENT_NOTE_REVISIONS_KEY);
  if (!(noteId in revisions)) return;
  delete revisions[noteId];
  writeNoteStorage(PATIENT_NOTE_REVISIONS_KEY, revisions);
}

function isCard(value: unknown): value is PatientCard {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PatientCard>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.summary === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string'
  );
}

function isNoteAttachedScore(value: unknown): value is NoteAttachedScore {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<NoteAttachedScore>;
  return (
    typeof candidate.label === 'string' &&
    typeof candidate.rawScore === 'number' &&
    typeof candidate.maximumScore === 'number' &&
    typeof candidate.percent === 'number'
  );
}

function isNoteAttachedOutput(value: unknown): value is NoteAttachedOutput {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<NoteAttachedOutput>;
  return typeof candidate.label === 'string' && typeof candidate.display === 'string';
}

function isNoteAttachedAssessmentResult(value: unknown): value is NoteAttachedAssessmentResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<NoteAttachedAssessmentResult>;
  return (
    candidate.kind === 'assessment' &&
    typeof candidate.recordId === 'string' &&
    typeof candidate.assessmentId === 'string' &&
    typeof candidate.slug === 'string' &&
    typeof candidate.specialtyId === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.headline === 'string' &&
    typeof candidate.summary === 'string' &&
    Array.isArray(candidate.scores) &&
    candidate.scores.every(isNoteAttachedScore) &&
    (candidate.manualText === undefined || typeof candidate.manualText === 'string') &&
    (candidate.disclaimer === undefined || typeof candidate.disclaimer === 'string')
  );
}

function isNoteAttachedCalculatorResult(value: unknown): value is NoteAttachedCalculatorResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<NoteAttachedCalculatorResult>;
  return (
    candidate.kind === 'calculator' &&
    typeof candidate.recordId === 'string' &&
    typeof candidate.calculatorId === 'string' &&
    typeof candidate.slug === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.inputSummary === 'string' &&
    Array.isArray(candidate.outputs) &&
    candidate.outputs.every(isNoteAttachedOutput) &&
    Array.isArray(candidate.warnings) &&
    candidate.warnings.every((warning): warning is string => typeof warning === 'string')
  );
}

function isNoteAttachedResult(value: unknown): value is NoteAttachedResult {
  return isNoteAttachedAssessmentResult(value) || isNoteAttachedCalculatorResult(value);
}

function isReminder(value: unknown): value is NoteReminder {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<NoteReminder>;
  return (
    typeof candidate.dueAt === 'string' &&
    typeof candidate.allDay === 'boolean' &&
    (candidate.notificationEnabled === undefined ||
      typeof candidate.notificationEnabled === 'boolean') &&
    (candidate.completedAt === null || typeof candidate.completedAt === 'string') &&
    typeof candidate.completionNote === 'string'
  );
}

function isNote(value: unknown): value is PatientNote {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PatientNote>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.cardId === 'string' &&
    (candidate.parentNoteId === null || typeof candidate.parentNoteId === 'string') &&
    typeof candidate.text === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    (candidate.reminder === undefined || isReminder(candidate.reminder))
  );
}

function normalizedAttachedResults(value: unknown): readonly NoteAttachedResult[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const results = value.filter(isNoteAttachedResult);
  return results.length > 0 ? results : undefined;
}

function noteAttachedSearchText(result: NoteAttachedResult): string {
  if (result.kind === 'assessment') {
    return [
      result.title,
      result.headline,
      result.summary,
      result.manualText,
      ...result.scores.map(
        (score) => `${score.label} ${score.rawScore} ${score.maximumScore} ${score.percent}`,
      ),
    ]
      .filter(Boolean)
      .join(' ');
  }
  return [
    result.title,
    result.inputSummary,
    ...result.outputs.map((output) => `${output.label} ${output.display}`),
    ...result.warnings,
  ].join(' ');
}

function noteSearchableText(text: string, attachedResults?: readonly NoteAttachedResult[]): string {
  const attachmentText = (attachedResults ?? []).map(noteAttachedSearchText).join(' ');
  return `${text} ${attachmentText}`.trim();
}

function normalizedNote(note: PatientNote): PatientNote {
  const { attachedResults: rawAttachedResults, ...rest } = note;
  const attachedResults = normalizedAttachedResults(rawAttachedResults);
  const searchableText = noteSearchableText(note.text, attachedResults);
  const normalized = {
    ...rest,
    categories: Array.isArray(note.categories)
      ? note.categories.filter((category): category is string => typeof category === 'string')
      : categorizeNoteText(searchableText),
    relatedDocumentIds: Array.isArray(note.relatedDocumentIds)
      ? note.relatedDocumentIds.filter(
          (documentId): documentId is string => typeof documentId === 'string',
        )
      : [],
    ...(attachedResults ? { attachedResults } : {}),
  };
  return note.reminder
    ? {
        ...normalized,
        reminder: {
          ...note.reminder,
          notificationEnabled: note.reminder.notificationEnabled ?? false,
        },
      }
    : normalized;
}

export function categorizeNoteText(text: string): readonly string[] {
  const normalized = text.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
  const categories = [
    [/(?:ребен|детск|педиатр|новорожден)/u, 'Педиатрия'],
    [/(?:операц|хирург|рана|перелом|шов)/u, 'Хирургия'],
    [/(?:препарат|лекарств|доз|таблет|инъекц|антибиот)/u, 'Препараты'],
    [/(?:анализ|диагност|узи|рентген|кт|мрт)/u, 'Диагностика'],
    [/(?:приказ|закон|справк|мсэ|инвалидност)/u, 'Право'],
  ]
    .filter(([pattern]) => (pattern as RegExp).test(normalized))
    .map(([, category]) => category as string);
  return categories.length > 0 ? categories : ['Общее'];
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadPatientNotes(): PatientNotesSnapshot {
  try {
    const raw = window.localStorage.getItem(PATIENT_NOTES_KEY);
    if (!raw) return EMPTY;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return EMPTY;
    const candidate = value as { readonly cards?: unknown; readonly notes?: unknown };
    const cards = Array.isArray(candidate.cards) ? candidate.cards.filter(isCard) : [];
    const notes = Array.isArray(candidate.notes)
      ? candidate.notes.filter(isNote).map(normalizedNote)
      : [];
    // Drop orphans so a partially corrupted record cannot hide notes under a missing card.
    const cardIds = new Set(cards.map((card) => card.id));
    return { cards, notes: notes.filter((note) => cardIds.has(note.cardId)) };
  } catch {
    return EMPTY;
  }
}

function persist(snapshot: PatientNotesSnapshot): PatientNotesSnapshot {
  window.localStorage.setItem(PATIENT_NOTES_KEY, JSON.stringify(snapshot));
  void persistToIndexedDb(snapshot).catch(() => {
    console.warn('Заметки сохранены локально, но IndexedDB сейчас недоступна.');
  });
  window.dispatchEvent(new CustomEvent(PATIENT_NOTES_EVENT, { detail: snapshot }));
  return snapshot;
}

/** Adds the editable welcome note once; its marker prevents a deleted note from returning. */
export function injectColleagueNote(): PatientNotesSnapshot {
  const current = loadPatientNotes();
  if (window.localStorage.getItem(COLLEAGUE_NOTE_MARKER_KEY)) return current;
  window.localStorage.setItem(COLLEAGUE_NOTE_MARKER_KEY, '1');
  if (
    current.cards.some((card) => card.id === COLLEAGUE_CARD_ID) ||
    current.notes.some((note) => note.id === COLLEAGUE_NOTE_ID)
  ) {
    return current;
  }
  const now = new Date().toISOString();
  return persist({
    cards: [
      {
        id: COLLEAGUE_CARD_ID,
        title: 'Привет, коллега!',
        summary: '',
        createdAt: now,
        updatedAt: now,
      },
      ...current.cards,
    ],
    notes: [
      ...current.notes,
      {
        id: COLLEAGUE_NOTE_ID,
        cardId: COLLEAGUE_CARD_ID,
        parentNoteId: null,
        text: COLLEAGUE_NOTE_TEXT,
        createdAt: now,
        updatedAt: now,
        categories: ['Общее'],
        relatedDocumentIds: [],
      },
    ],
  });
}

function openNotesDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SNAPSHOT_STORE)) {
        request.result.createObjectStore(SNAPSHOT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть заметки.'));
  });
}

async function persistToIndexedDb(snapshot: PatientNotesSnapshot): Promise<void> {
  if (!('indexedDB' in globalThis) || !indexedDB) return;
  const database = await openNotesDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(SNAPSHOT_STORE, 'readwrite');
      transaction.objectStore(SNAPSHOT_STORE).put(snapshot, 'current');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось сохранить заметки.'));
    });
  } finally {
    database.close();
  }
}

export async function hydratePatientNotesFromIndexedDb(): Promise<PatientNotesSnapshot> {
  const local = loadPatientNotes();
  if (local.cards.length > 0 || local.notes.length > 0) {
    await persistToIndexedDb(local);
    return local;
  }
  if (!('indexedDB' in globalThis) || !indexedDB) return local;
  const database = await openNotesDatabase();
  try {
    const stored = await new Promise<PatientNotesSnapshot | undefined>((resolve, reject) => {
      const request = database
        .transaction(SNAPSHOT_STORE, 'readonly')
        .objectStore(SNAPSHOT_STORE)
        .get('current') as IDBRequest<PatientNotesSnapshot | undefined>;
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Не удалось прочитать заметки.'));
    });
    if (!stored) return local;
    return persist({
      cards: stored.cards.filter(isCard),
      notes: stored.notes.filter(isNote).map(normalizedNote),
    });
  } finally {
    database.close();
  }
}

export function createPatientCard(title: string, summary = ''): PatientNotesSnapshot {
  const trimmed = title.trim();
  if (!trimmed) return loadPatientNotes();
  const now = new Date().toISOString();
  const current = loadPatientNotes();
  const card: PatientCard = {
    id: createId('card'),
    title: trimmed,
    summary: summary.trim(),
    createdAt: now,
    updatedAt: now,
  };
  return persist({ cards: [card, ...current.cards], notes: current.notes });
}

export function updatePatientCard(
  cardId: string,
  changes: { readonly title?: string; readonly summary?: string },
): PatientNotesSnapshot {
  const current = loadPatientNotes();
  const now = new Date().toISOString();
  return persist({
    cards: current.cards.map((card) =>
      card.id === cardId
        ? {
            ...card,
            title: changes.title?.trim() ? changes.title.trim() : card.title,
            summary: changes.summary === undefined ? card.summary : changes.summary.trim(),
            updatedAt: now,
          }
        : card,
    ),
    notes: current.notes,
  });
}

/** Removes a card together with every note beneath it: a card is the retention boundary. */
export function removePatientCard(cardId: string): PatientNotesSnapshot {
  const current = loadPatientNotes();
  const doomedNoteIds = current.notes
    .filter((note) => note.cardId === cardId)
    .map((note) => note.id);
  for (const noteId of doomedNoteIds) {
    removePatientNoteDraft(noteId);
    removePatientNoteRevision(noteId);
  }
  void deleteNoteImagesForNotes(doomedNoteIds).catch(() =>
    console.warn('Не удалось удалить изображения карточки.'),
  );
  return persist({
    cards: current.cards.filter((card) => card.id !== cardId),
    notes: current.notes.filter((note) => note.cardId !== cardId),
  });
}

export function addPatientNote(
  cardId: string,
  text: string,
  parentNoteId: string | null = null,
  options?: { readonly attachedResults?: readonly NoteAttachedResult[] },
): PatientNotesSnapshot {
  const trimmed = text.trim();
  const attachedResults = normalizedAttachedResults(options?.attachedResults);
  const hasAttachments = (attachedResults?.length ?? 0) > 0;
  const current = loadPatientNotes();
  if ((!trimmed && !hasAttachments) || !current.cards.some((card) => card.id === cardId)) {
    return current;
  }
  if (parentNoteId && !current.notes.some((note) => note.id === parentNoteId)) return current;
  const now = new Date().toISOString();
  const note: PatientNote = {
    id: createId('note'),
    cardId,
    parentNoteId,
    text: trimmed,
    createdAt: now,
    updatedAt: now,
    categories: categorizeNoteText(noteSearchableText(trimmed, attachedResults)),
    relatedDocumentIds: [],
    ...(attachedResults ? { attachedResults } : {}),
  };
  return persist({ cards: current.cards, notes: [...current.notes, note] });
}

export function updatePatientNote(noteId: string, text: string): PatientNotesSnapshot {
  const trimmed = text.trim();
  const current = loadPatientNotes();
  const existing = current.notes.find((note) => note.id === noteId);
  if (!existing) return current;
  const hasAttachments = (existing.attachedResults?.length ?? 0) > 0;
  if (!trimmed && !hasAttachments) return current;
  if (existing.text === trimmed) return current;
  savePreviousPatientNoteRevision(existing);
  const now = new Date().toISOString();
  return persist({
    cards: current.cards,
    notes: current.notes.map((note) =>
      note.id === noteId
        ? {
            ...note,
            text: trimmed,
            categories: categorizeNoteText(noteSearchableText(trimmed, note.attachedResults)),
            updatedAt: now,
          }
        : note,
    ),
  });
}

export async function enrichPatientNote(noteId: string, core: MedicalCore): Promise<void> {
  const current = loadPatientNotes();
  const note = current.notes.find((item) => item.id === noteId);
  if (!note) return;
  const query = noteSearchableText(note.text, note.attachedResults);
  if (!query) return;
  const result = await core.search({
    query,
    mode: 'auto',
    filters: {},
    limit: 5,
    includeSuggestions: false,
  });
  if (!result.ok) return;
  const meaningfulTerms = new Set(tokenize(query).map(lightStemRussian)).size;
  const minimumMatches = meaningfulTerms >= 3 ? 2 : 1;
  const relatedDocumentIds = result.value.groups
    .filter((group) =>
      group.results.some(
        (searchResult) =>
          new Set(searchResult.matchedTerms.map(lightStemRussian)).size >= minimumMatches,
      ),
    )
    .map((group) => group.documentId)
    .slice(0, 5);
  const latest = loadPatientNotes();
  persist({
    cards: latest.cards,
    notes: latest.notes.map((item) =>
      item.id === noteId ? { ...item, relatedDocumentIds } : item,
    ),
  });
}

/** Removes a note and its descendants, so deleting a visit cannot leave dangling follow-ups. */
export function removePatientNote(noteId: string): PatientNotesSnapshot {
  const current = loadPatientNotes();
  const doomed = new Set<string>([noteId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const note of current.notes) {
      if (note.parentNoteId && doomed.has(note.parentNoteId) && !doomed.has(note.id)) {
        doomed.add(note.id);
        grew = true;
      }
    }
  }
  for (const doomedNoteId of doomed) {
    removePatientNoteDraft(doomedNoteId);
    removePatientNoteRevision(doomedNoteId);
  }
  void deleteNoteImagesForNotes([...doomed]).catch(() =>
    console.warn('Не удалось удалить изображения записи.'),
  );
  return persist({
    cards: current.cards,
    notes: current.notes.filter((note) => !doomed.has(note.id)),
  });
}

/**
 * Attaches or reschedules a reminder. A new reminder may point at any future moment; an existing
 * pending reminder can only move forward — a follow-up is postponed, never quietly moved earlier.
 */
export function setNoteReminder(
  noteId: string,
  dueAt: string,
  allDay: boolean,
  notificationEnabled = false,
): PatientNotesSnapshot {
  const current = loadPatientNotes();
  const note = current.notes.find((item) => item.id === noteId);
  if (!note) return current;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime()) || due.getTime() <= Date.now()) return current;
  const existing = note.reminder;
  if (
    existing &&
    existing.completedAt === null &&
    due.getTime() < new Date(existing.dueAt).getTime()
  ) {
    return current;
  }
  const reminder: NoteReminder = {
    dueAt: due.toISOString(),
    allDay,
    notificationEnabled,
    completedAt: null,
    completionNote: existing?.completionNote ?? '',
  };
  return persist({
    cards: current.cards,
    notes: current.notes.map((item) =>
      item.id === noteId ? { ...item, reminder, updatedAt: new Date().toISOString() } : item,
    ),
  });
}

export function completeNoteReminder(noteId: string, completionNote: string): PatientNotesSnapshot {
  const current = loadPatientNotes();
  const note = current.notes.find((item) => item.id === noteId);
  if (!note?.reminder || note.reminder.completedAt !== null) return current;
  const now = new Date().toISOString();
  const reminder: NoteReminder = {
    ...note.reminder,
    completedAt: now,
    completionNote: completionNote.trim(),
  };
  return persist({
    cards: current.cards,
    notes: current.notes.map((item) =>
      item.id === noteId ? { ...item, reminder, updatedAt: now } : item,
    ),
  });
}

export function isReminderDue(reminder: NoteReminder, at = Date.now()): boolean {
  return reminder.completedAt === null && new Date(reminder.dueAt).getTime() <= at;
}

/** Notes whose pending reminder has come due, most overdue first. */
export function dueReminderNotes(
  snapshot: PatientNotesSnapshot,
  at = Date.now(),
): readonly PatientNote[] {
  return snapshot.notes
    .filter((note) => note.reminder && isReminderDue(note.reminder, at))
    .toSorted((left, right) =>
      (left.reminder?.dueAt ?? '').localeCompare(right.reminder?.dueAt ?? ''),
    );
}

export function childNotes(
  snapshot: PatientNotesSnapshot,
  cardId: string,
  parentNoteId: string | null,
): readonly PatientNote[] {
  return snapshot.notes
    .filter((note) => note.cardId === cardId && note.parentNoteId === parentNoteId)
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function snippetFor(text: string, queryStems: readonly string[]): string {
  const words = text.split(/\s+/u);
  const hitIndex = words.findIndex((word) => wordMatchesQueryStem(word, queryStems));
  if (hitIndex < 0) {
    return text.length <= MAX_SNIPPET_LENGTH ? text : `${text.slice(0, MAX_SNIPPET_LENGTH - 1)}…`;
  }
  const start = Math.max(0, hitIndex - 6);
  const snippet = words.slice(start, start + 18).join(' ');
  const prefix = start > 0 ? '…' : '';
  const suffix = start + 18 < words.length ? '…' : '';
  return `${prefix}${snippet}${suffix}`;
}

/**
 * Matches personal records for a query. Distinctive stems must all appear (inflected forms count);
 * a shared generic leftover like «мг» or «дети» is not enough when the query names a specific term.
 */
export function searchPatientNotes(query: string, limit = 8): readonly PatientNoteMatch[] {
  const queryStems = personalQueryStems(query);
  if (queryStems.length === 0) return [];
  const snapshot = loadPatientNotes();
  const cardsById = new Map(snapshot.cards.map((card) => [card.id, card]));
  const matches: PatientNoteMatch[] = [];

  const scoreOf = (text: string): number => personalMatchScore(queryStems, text);

  for (const card of snapshot.cards) {
    const score = scoreOf(`${card.title} ${card.summary}`);
    if (score > 0) {
      matches.push({
        card,
        note: null,
        score,
        snippet: snippetFor(card.summary || card.title, queryStems),
      });
    }
  }

  for (const note of snapshot.notes) {
    const card = cardsById.get(note.cardId);
    if (!card) continue;
    const searchableText = noteSearchableText(note.text, note.attachedResults);
    const score = scoreOf(searchableText);
    if (score > 0) {
      matches.push({ card, note, score, snippet: snippetFor(searchableText, queryStems) });
    }
  }

  return matches
    .toSorted((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftAt = left.note?.updatedAt ?? left.card.updatedAt;
      const rightAt = right.note?.updatedAt ?? right.card.updatedAt;
      return rightAt.localeCompare(leftAt);
    })
    .slice(0, limit);
}
