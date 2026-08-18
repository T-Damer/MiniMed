import type { MedicalCore } from '@localmed/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addPatientNote,
  categorizeNoteText,
  childNotes,
  completeNoteReminder,
  createPatientCard,
  dueReminderNotes,
  enrichPatientNote,
  injectColleagueNote,
  loadPatientNoteDraft,
  loadPatientNotes,
  loadPreviousPatientNoteRevision,
  type NoteAttachedAssessmentResult,
  type NoteAttachedCalculatorResult,
  PATIENT_NOTES_KEY,
  removePatientCard,
  removePatientNote,
  removePatientNoteDraft,
  savePatientNoteDraft,
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

  it('categorizes a new note without a model', () => {
    expect(categorizeNoteText('Ребёнку назначен антибиотик после анализа крови')).toEqual([
      'Педиатрия',
      'Препараты',
      'Диагностика',
    ]);
  });

  it('adds the colleague note once and keeps it removed', () => {
    const injected = injectColleagueNote();
    const cardId = injected.cards[0]?.id ?? '';
    expect(injected.cards[0]?.title).toBe('Привет, коллега!');
    expect(injected.notes[0]?.cardId).toBe(cardId);

    removePatientCard(cardId);
    expect(injectColleagueNote().cards).toHaveLength(0);
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

  it('does not match a drug query from a leftover generic word in the note', () => {
    createPatientCard('Иванов И., 3 года, 20 кг');
    const cardId = cardIdOf('Иванов И., 3 года, 20 кг');
    addPatientNote(cardId, 'осмотр ребёнка, вес 20 кг, доза в мг');
    expect(searchPatientNotes('парацетамол детям')).toHaveLength(0);
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

  it('round-trips structured attachments through localStorage', () => {
    createPatientCard('Иванов И.');
    const cardId = cardIdOf('Иванов И.');
    const assessmentAttachment: NoteAttachedAssessmentResult = {
      kind: 'assessment',
      recordId: 'assessment-1',
      assessmentId: 'demo',
      slug: 'demo-scale',
      specialtyId: 'psychiatry',
      title: 'Тест Бравермана',
      headline: 'Низкий риск',
      summary: 'Продолжить наблюдение.',
      scores: [{ label: 'Сумма', rawScore: 3, maximumScore: 10, percent: 30 }],
      disclaimer: 'Не диагноз.',
    };
    const calculatorAttachment: NoteAttachedCalculatorResult = {
      kind: 'calculator',
      recordId: 'calc-1',
      calculatorId: 'bsa',
      slug: 'bsa',
      title: 'Площадь поверхности тела',
      inputSummary: 'Рост 170 см, масса 70 кг',
      outputs: [{ label: 'Результат', display: '1,82 м²' }],
      warnings: [],
    };

    addPatientNote(cardId, 'Опросник', null, { attachedResults: [assessmentAttachment] });
    addPatientNote(cardId, '', null, { attachedResults: [calculatorAttachment] });

    const raw = store.get(PATIENT_NOTES_KEY);
    expect(raw).toBeTruthy();
    const reloaded = loadPatientNotes();
    expect(reloaded.notes[0]?.attachedResults?.[0]).toMatchObject({
      kind: 'assessment',
      recordId: 'assessment-1',
      title: 'Тест Бравермана',
    });
    expect(reloaded.notes[1]?.text).toBe('');
    expect(reloaded.notes[1]?.attachedResults?.[0]).toMatchObject({
      kind: 'calculator',
      outputs: [{ display: '1,82 м²' }],
    });
  });

  it('drops malformed attached results on load', () => {
    createPatientCard('Иванов И.');
    const cardId = cardIdOf('Иванов И.');
    addPatientNote(cardId, 'заметка');
    const noteId = loadPatientNotes().notes[0]?.id ?? '';
    store.set(
      PATIENT_NOTES_KEY,
      JSON.stringify({
        cards: loadPatientNotes().cards,
        notes: [
          {
            ...loadPatientNotes().notes[0],
            attachedResults: [{ kind: 'assessment', recordId: 'broken' }, { kind: 'unknown' }],
          },
        ],
      }),
    );
    const note = loadPatientNotes().notes.find((item) => item.id === noteId);
    expect(note?.attachedResults).toBeUndefined();
  });

  it('allows empty text only when attachments are present', () => {
    createPatientCard('Иванов И.');
    const cardId = cardIdOf('Иванов И.');
    expect(addPatientNote(cardId, '   ').notes).toHaveLength(0);
    const withAttachment = addPatientNote(cardId, '   ', null, {
      attachedResults: [
        {
          kind: 'calculator',
          recordId: 'calc-2',
          calculatorId: 'bsa',
          slug: 'bsa',
          title: 'Площадь поверхности тела',
          inputSummary: 'Рост 170 см',
          outputs: [{ label: 'Результат', display: '1,82 м²' }],
          warnings: [],
        },
      ],
    });
    expect(withAttachment.notes).toHaveLength(1);
    expect(withAttachment.notes[0]?.text).toBe('');
  });

  it('preserves attachments when updating note text', () => {
    createPatientCard('Иванов И.');
    const cardId = cardIdOf('Иванов И.');
    addPatientNote(cardId, 'подпись', null, {
      attachedResults: [
        {
          kind: 'assessment',
          recordId: 'assessment-2',
          assessmentId: 'demo',
          slug: 'demo-scale',
          specialtyId: 'psychiatry',
          title: 'Тест Бравермана',
          headline: 'Низкий риск',
          summary: 'Наблюдение.',
          scores: [],
        },
      ],
    });
    const noteId = loadPatientNotes().notes[0]?.id ?? '';
    updatePatientNote(noteId, '');
    const note = loadPatientNotes().notes[0];
    expect(note?.text).toBe('');
    expect(note?.attachedResults?.[0]?.title).toBe('Тест Бравермана');
  });

  it('finds notes by attachment title or output even with a short caption', () => {
    createPatientCard('Иванов И.');
    const cardId = cardIdOf('Иванов И.');
    addPatientNote(cardId, 'расчёт', null, {
      attachedResults: [
        {
          kind: 'calculator',
          recordId: 'calc-3',
          calculatorId: 'edd',
          slug: 'edd',
          title: 'ПДР по УЗИ',
          inputSummary: 'УЗИ 20 недель',
          outputs: [{ label: 'ПДР', display: '5 февраля 2027 г.' }],
          warnings: [],
        },
      ],
    });

    expect(searchPatientNotes('5 февраля 2027')[0]?.note?.attachedResults?.[0]?.kind).toBe(
      'calculator',
    );
    expect(searchPatientNotes('ПДР по УЗИ')[0]?.note).toBeTruthy();
  });

  it('keeps an autosaved draft separate from the previous stable revision', () => {
    createPatientCard('Иванов И.');
    const cardId = cardIdOf('Иванов И.');
    addPatientNote(cardId, 'первая версия');
    const noteId = loadPatientNotes().notes[0]?.id ?? '';

    savePatientNoteDraft({
      noteId,
      text: 'черновик версии',
      reminderDate: '',
      reminderTime: '',
      savedAt: '2026-08-15T10:00:00.000Z',
    });
    expect(loadPatientNoteDraft(noteId)?.text).toBe('черновик версии');

    updatePatientNote(noteId, 'стабильная новая версия');
    expect(loadPreviousPatientNoteRevision(noteId)?.text).toBe('первая версия');
    expect(loadPatientNotes().notes[0]?.text).toBe('стабильная новая версия');

    removePatientNoteDraft(noteId);
    expect(loadPatientNoteDraft(noteId)).toBeNull();
  });

  it('keeps only sources matching more than one meaningful term', async () => {
    createPatientCard('Иванов И.');
    const cardId = cardIdOf('Иванов И.');
    addPatientNote(cardId, 'назначен цефтриаксон при пневмонии');
    const noteId = loadPatientNotes().notes[0]?.id ?? '';
    const core = {
      search: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          groups: [
            {
              documentId: 'generic',
              results: [{ matchedTerms: ['пневмония'] }],
            },
            {
              documentId: 'relevant',
              results: [{ matchedTerms: ['цефтриаксон', 'пневмония'] }],
            },
          ],
        },
      }),
    } as unknown as MedicalCore;

    await enrichPatientNote(noteId, core);
    expect(loadPatientNotes().notes[0]?.relatedDocumentIds).toEqual(['relevant']);
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
    setNoteReminder(noteId, future, false, true);
    expect(loadPatientNotes().notes[0]?.reminder?.completedAt).toBeNull();
    expect(loadPatientNotes().notes[0]?.reminder?.notificationEnabled).toBe(true);

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
