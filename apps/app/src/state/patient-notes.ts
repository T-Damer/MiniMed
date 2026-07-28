import type { MedicalCore } from '@localmed/contracts';
import { lightStemRussian, tokenize } from '@localmed/search-lexical';

import { deleteNoteImagesForNotes } from '@/state/note-images';

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
  readonly reminder?: NoteReminder;
}

export interface PatientNotesSnapshot {
  readonly cards: readonly PatientCard[];
  readonly notes: readonly PatientNote[];
}

export interface PatientNoteMatch {
  readonly card: PatientCard;
  /** Absent when the card itself matched rather than one of its notes. */
  readonly note: PatientNote | null;
  readonly score: number;
  readonly snippet: string;
}

export const PATIENT_NOTES_KEY = 'minimed.patient-notes.v1';
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

function normalizedNote(note: PatientNote): PatientNote {
  const normalized = {
    ...note,
    categories: Array.isArray(note.categories)
      ? note.categories.filter((category): category is string => typeof category === 'string')
      : categorizeNoteText(note.text),
    relatedDocumentIds: Array.isArray(note.relatedDocumentIds)
      ? note.relatedDocumentIds.filter(
          (documentId): documentId is string => typeof documentId === 'string',
        )
      : [],
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
  void deleteNoteImagesForNotes(
    current.notes.filter((note) => note.cardId === cardId).map((note) => note.id),
  ).catch(() => console.warn('Не удалось удалить изображения карточки.'));
  return persist({
    cards: current.cards.filter((card) => card.id !== cardId),
    notes: current.notes.filter((note) => note.cardId !== cardId),
  });
}

export function addPatientNote(
  cardId: string,
  text: string,
  parentNoteId: string | null = null,
): PatientNotesSnapshot {
  const trimmed = text.trim();
  const current = loadPatientNotes();
  if (!trimmed || !current.cards.some((card) => card.id === cardId)) return current;
  if (parentNoteId && !current.notes.some((note) => note.id === parentNoteId)) return current;
  const now = new Date().toISOString();
  const note: PatientNote = {
    id: createId('note'),
    cardId,
    parentNoteId,
    text: trimmed,
    createdAt: now,
    updatedAt: now,
    categories: categorizeNoteText(trimmed),
    relatedDocumentIds: [],
  };
  return persist({ cards: current.cards, notes: [...current.notes, note] });
}

export function updatePatientNote(noteId: string, text: string): PatientNotesSnapshot {
  const trimmed = text.trim();
  const current = loadPatientNotes();
  if (!trimmed) return current;
  const now = new Date().toISOString();
  return persist({
    cards: current.cards,
    notes: current.notes.map((note) =>
      note.id === noteId
        ? { ...note, text: trimmed, categories: categorizeNoteText(trimmed), updatedAt: now }
        : note,
    ),
  });
}

export async function enrichPatientNote(noteId: string, core: MedicalCore): Promise<void> {
  const current = loadPatientNotes();
  const note = current.notes.find((item) => item.id === noteId);
  if (!note) return;
  const result = await core.search({
    query: note.text,
    mode: 'auto',
    filters: {},
    limit: 5,
    includeSuggestions: false,
  });
  if (!result.ok) return;
  const meaningfulTerms = new Set(tokenize(note.text).map(lightStemRussian)).size;
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

function stems(value: string): readonly string[] {
  return tokenize(value).map(lightStemRussian);
}

function snippetFor(text: string, queryStems: readonly string[]): string {
  const words = text.split(/\s+/u);
  const hitIndex = words.findIndex((word) => {
    const stem = lightStemRussian(tokenize(word)[0] ?? '');
    return stem.length > 0 && queryStems.includes(stem);
  });
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
 * Matches personal records for a query. Deliberately simple stem overlap: personal collections are
 * small, and a doctor needs predictable recall of their own wording rather than ranking subtleties.
 */
export function searchPatientNotes(query: string, limit = 8): readonly PatientNoteMatch[] {
  const queryStems = [...new Set(stems(query))];
  if (queryStems.length === 0) return [];
  const snapshot = loadPatientNotes();
  const cardsById = new Map(snapshot.cards.map((card) => [card.id, card]));
  const matches: PatientNoteMatch[] = [];

  const scoreOf = (text: string): number => {
    const textStems = new Set(stems(text));
    return queryStems.filter((stem) => textStems.has(stem)).length;
  };

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
    const score = scoreOf(note.text);
    if (score > 0) {
      matches.push({ card, note, score, snippet: snippetFor(note.text, queryStems) });
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
