import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addPatientNote,
  childNotes,
  createPatientCard,
  loadPatientNotes,
  PATIENT_NOTES_KEY,
  removePatientCard,
  removePatientNote,
  searchPatientNotes,
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
