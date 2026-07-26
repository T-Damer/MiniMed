import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addPatientNote,
  childNotes,
  completeNoteReminder,
  createPatientCard,
  dueReminderNotes,
  loadPatientNotes,
  PATIENT_NOTES_KEY,
  removePatientCard,
  removePatientNote,
  searchPatientNotes,
  setNoteReminder,
  updatePatientNote,
} from '@/state/patient-notes';

function installLocalStorageMock(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
    dispatchEvent: () => true,
    CustomEvent: globalThis.CustomEvent,
  });
  return store;
}

function cardIdOf(title: string): string {
  const card = loadPatientNotes().cards.find((item) => item.title === title);
  if (!card) throw new Error(`card ${title} was not created`);
  return card.id;
}

describe('patient notes store', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installLocalStorageMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps notes nested under the visit they belong to', () => {
    createPatientCard('Иванов И., 3 года, 20 кг', 'аллергия на пенициллин');
    const cardId = cardIdOf('Иванов И., 3 года, 20 кг');
    addPatientNote(cardId, 'Первичный осмотр: температура 38,5, кашель');
    const snapshot = loadPatientNotes();
    const visit = snapshot.notes[0];
    if (!visit) throw new Error('visit note missing');
    addPatientNote(cardId, 'Контроль через 48 часов: температура снизилась', visit.id);

    const top = childNotes(loadPatientNotes(), cardId, null);
    expect(top).toHaveLength(1);
    const followUps = childNotes(loadPatientNotes(), cardId, visit.id);
    expect(followUps).toHaveLength(1);
    expect(followUps[0]?.text).toContain('Контроль через 48 часов');
  });

  it('refuses a note without a card and an orphan nesting target', () => {
    expect(addPatientNote('card-missing', 'текст').notes).toHaveLength(0);
    createPatientCard('Петров П.');
    const cardId = cardIdOf('Петров П.');
    expect(addPatientNote(cardId, 'текст', 'note-missing').notes).toHaveLength(0);
    expect(addPatientNote(cardId, '   ').notes).toHaveLength(0);
  });

  it('removes descendants when a note or a card is deleted', () => {
    createPatientCard('Сидорова А.');
    const cardId = cardIdOf('Сидорова А.');
    addPatientNote(cardId, 'Визит');
    const visitId = loadPatientNotes().notes[0]?.id ?? '';
    addPatientNote(cardId, 'Повтор', visitId);
    const followUpId = loadPatientNotes().notes[1]?.id ?? '';
    addPatientNote(cardId, 'Уточнение к повтору', followUpId);
    expect(loadPatientNotes().notes).toHaveLength(3);

    removePatientNote(visitId);
    expect(loadPatientNotes().notes).toHaveLength(0);

    addPatientNote(cardId, 'Новый визит');
    removePatientCard(cardId);
    const snapshot = loadPatientNotes();
    expect(snapshot.cards).toHaveLength(0);
    expect(snapshot.notes).toHaveLength(0);
  });

  it('drops notes whose card is missing from a corrupted record', () => {
    store.set(
      PATIENT_NOTES_KEY,
      JSON.stringify({
        cards: [],
        notes: [
          {
            id: 'note-1',
            cardId: 'card-gone',
            parentNoteId: null,
            text: 'осиротевшая заметка',
            createdAt: '2026-07-26T00:00:00.000Z',
            updatedAt: '2026-07-26T00:00:00.000Z',
          },
        ],
      }),
    );
    expect(loadPatientNotes().notes).toHaveLength(0);
  });

  it('survives a corrupted payload instead of throwing', () => {
    store.set(PATIENT_NOTES_KEY, '{not json');
    expect(loadPatientNotes()).toEqual({ cards: [], notes: [] });
  });

  it('finds a note by Russian wording in a different grammatical form', () => {
    createPatientCard('Иванов И., 3 года', 'вес 20 кг');
    const cardId = cardIdOf('Иванов И., 3 года');
    addPatientNote(cardId, 'Назначен цефтриаксон внутримышечно, вторая линия при пневмонии');
    addPatientNote(cardId, 'Мать сообщила о сыпи после амоксициллина');

    const matches = searchPatientNotes('цефтриаксона пневмония');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.note?.text).toContain('цефтриаксон');
    expect(matches[0]?.card.title).toBe('Иванов И., 3 года');

    const allergy = searchPatientNotes('сыпь амоксициллин');
    expect(allergy[0]?.note?.text).toContain('сыпи');
  });

  it('matches a card by its own summary and reports no note', () => {
    createPatientCard('Смирнов Д.', 'аллергия на пенициллин, вес 15 кг');
    const matches = searchPatientNotes('пенициллин аллергия');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.note).toBeNull();
    expect(matches[0]?.snippet).toContain('пенициллин');
  });

  it('returns nothing for a query with no shared terms', () => {
    createPatientCard('Иванов И.');
    const cardId = cardIdOf('Иванов И.');
    addPatientNote(cardId, 'ротавирус, оральная регидратация');
    expect(searchPatientNotes('перелом лучевой кости')).toHaveLength(0);
    expect(searchPatientNotes('   ')).toHaveLength(0);
  });

  it('ranks the note with more query terms first', () => {
    createPatientCard('Иванов И.');
    const cardId = cardIdOf('Иванов И.');
    addPatientNote(cardId, 'пневмония');
    addPatientNote(cardId, 'пневмония, назначен цефтриаксон, вес 20 кг');
    const matches = searchPatientNotes('пневмония цефтриаксон вес');
    expect(matches[0]?.note?.text).toContain('цефтриаксон');
  });

  it('keeps an edit and refuses to blank a note', () => {
    createPatientCard('Иванов И.');
    const cardId = cardIdOf('Иванов И.');
    addPatientNote(cardId, 'первая версия');
    const noteId = loadPatientNotes().notes[0]?.id ?? '';
    updatePatientNote(noteId, 'исправленная версия');
    expect(loadPatientNotes().notes[0]?.text).toBe('исправленная версия');
    updatePatientNote(noteId, '   ');
    expect(loadPatientNotes().notes[0]?.text).toBe('исправленная версия');
  });
});

describe('note reminders', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installLocalStorageMock();
    void store;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function noteIdWith(text: string): string {
    createPatientCard('Иванов И.');
    const cardId = cardIdOf('Иванов И.');
    addPatientNote(cardId, text);
    const note = loadPatientNotes().notes.find((item) => item.text === text);
    if (!note) throw new Error('note missing');
    return note.id;
  }

  it('attaches a future reminder and rejects one in the past', () => {
    const noteId = noteIdWith('контроль анализа мочи');
    const future = new Date(Date.now() + 86_400_000).toISOString();
    setNoteReminder(noteId, future, false);
    expect(loadPatientNotes().notes[0]?.reminder?.completedAt).toBeNull();

    const past = new Date(Date.now() - 3_600_000).toISOString();
    const before = loadPatientNotes().notes[0]?.reminder?.dueAt;
    setNoteReminder(noteId, past, false);
    expect(loadPatientNotes().notes[0]?.reminder?.dueAt).toBe(before);
  });

  it('lets a pending reminder move only forward', () => {
    const noteId = noteIdWith('повторный осмотр');
    const dayAhead = Date.now() + 86_400_000;
    setNoteReminder(noteId, new Date(dayAhead).toISOString(), false);

    setNoteReminder(noteId, new Date(dayAhead - 3_600_000).toISOString(), false);
    expect(loadPatientNotes().notes[0]?.reminder?.dueAt).toBe(new Date(dayAhead).toISOString());

    setNoteReminder(noteId, new Date(dayAhead + 3_600_000).toISOString(), false);
    expect(loadPatientNotes().notes[0]?.reminder?.dueAt).toBe(
      new Date(dayAhead + 3_600_000).toISOString(),
    );
  });

  it('completes with the condition preserved and stops being due', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T10:00:00Z'));
    const noteId = noteIdWith('контроль сатурации');
    setNoteReminder(noteId, '2026-07-27T10:00:00.000Z', false);

    vi.setSystemTime(new Date('2026-07-28T10:00:00Z'));
    expect(dueReminderNotes(loadPatientNotes())).toHaveLength(1);

    completeNoteReminder(noteId, 'сатурация 97, жалоб нет');
    const reminder = loadPatientNotes().notes[0]?.reminder;
    expect(reminder?.completedAt).not.toBeNull();
    expect(reminder?.completionNote).toBe('сатурация 97, жалоб нет');
    expect(dueReminderNotes(loadPatientNotes())).toHaveLength(0);

    // Completing twice must not overwrite the recorded condition.
    completeNoteReminder(noteId, 'другой текст');
    expect(loadPatientNotes().notes[0]?.reminder?.completionNote).toBe('сатурация 97, жалоб нет');
  });

  it('orders due reminders most overdue first', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T10:00:00Z'));
    createPatientCard('Иванов И.');
    const cardId = cardIdOf('Иванов И.');
    addPatientNote(cardId, 'первый контроль');
    addPatientNote(cardId, 'второй контроль');
    const [first, second] = loadPatientNotes().notes;
    if (!first || !second) throw new Error('notes missing');
    setNoteReminder(first.id, '2026-07-27T09:00:00.000Z', false);
    setNoteReminder(second.id, '2026-07-26T12:00:00.000Z', false);

    vi.setSystemTime(new Date('2026-07-28T10:00:00Z'));
    const due = dueReminderNotes(loadPatientNotes());
    expect(due.map((note) => note.text)).toEqual(['второй контроль', 'первый контроль']);
  });
});
