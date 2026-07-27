import { TextField } from '@kobalte/core/text-field';
import type { MedicalCore, MedicalDocumentSummary } from '@localmed/contracts';
import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { openDocumentOverlay } from '@/state/document-navigation';
import {
  addPatientNote,
  completeNoteReminder,
  createPatientCard,
  enrichPatientNote,
  hydratePatientNotesFromIndexedDb,
  isReminderDue,
  loadPatientNotes,
  type NoteReminder,
  PATIENT_NOTES_EVENT,
  type PatientCard,
  type PatientNote,
  type PatientNotesSnapshot,
  removePatientCard,
  removePatientNote,
  setNoteReminder,
  updatePatientCard,
  updatePatientNote,
} from '@/state/patient-notes';

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatReminderDate(reminder: NoteReminder): string {
  const date = new Date(reminder.dueAt);
  if (Number.isNaN(date.getTime())) return reminder.dueAt;
  return new Intl.DateTimeFormat(
    'ru-RU',
    reminder.allDay
      ? { day: '2-digit', month: 'short', year: 'numeric' }
      : {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        },
  ).format(date);
}

function composeDueAt(
  dateValue: string,
  timeValue: string,
): { dueAt: string; allDay: boolean } | null {
  if (!dateValue) return null;
  const date = new Date(`${dateValue}T${timeValue || '00:00'}`);
  if (Number.isNaN(date.getTime())) return null;
  const dueAt = !timeValue && date.getTime() <= Date.now() ? new Date(Date.now() + 60_000) : date;
  return { dueAt: dueAt.toISOString(), allDay: !timeValue };
}

function reminderFieldsValue(form: HTMLFormElement): { dueAt: string; allDay: boolean } | null {
  const date = form.elements.namedItem('reminder-date');
  const time = form.elements.namedItem('reminder-time');
  return composeDueAt(
    date instanceof HTMLInputElement ? date.value : '',
    time instanceof HTMLInputElement ? time.value : '',
  );
}

function NoteTextArea(props: {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
}): JSX.Element {
  return (
    <TextField name={props.name} value={props.value} onChange={props.onChange}>
      <TextField.Label class="visually-hidden">{props.label}</TextField.Label>
      <TextField.TextArea
        autoResize
        aria-label={props.label}
        placeholder={props.placeholder}
        rows={2}
      />
    </TextField>
  );
}

function ReminderFields(): JSX.Element {
  return (
    <div class="note-reminder-fields">
      <span>Напомнить</span>
      <input type="date" name="reminder-date" aria-label="Дата напоминания" />
      <input type="time" name="reminder-time" aria-label="Время напоминания" />
    </div>
  );
}

function deferEnrichment(noteId: string, core: MedicalCore): void {
  window.setTimeout(() => void enrichPatientNote(noteId, core), 0);
}

export function NotesView(props: { readonly core: MedicalCore }): JSX.Element {
  const [snapshot, setSnapshot] = createSignal<PatientNotesSnapshot>({ cards: [], notes: [] });
  const [documents, setDocuments] = createSignal<readonly MedicalDocumentSummary[]>([]);
  const [creating, setCreating] = createSignal(false);
  const [activeCardId, setActiveCardId] = createSignal<string | null>(null);
  const [activeNoteId, setActiveNoteId] = createSignal<string | null>(null);
  const [reminderNoteId, setReminderNoteId] = createSignal<string | null>(null);
  const [editingCard, setEditingCard] = createSignal(false);
  const [editingNote, setEditingNote] = createSignal(false);
  const [cardTitleDraft, setCardTitleDraft] = createSignal('');
  const [cardSummaryDraft, setCardSummaryDraft] = createSignal('');
  const [noteDraft, setNoteDraft] = createSignal('');
  const [editNoteDraft, setEditNoteDraft] = createSignal('');
  const [completionDraft, setCompletionDraft] = createSignal('');
  const [clock, setClock] = createSignal(Date.now());

  const refresh = (): void => {
    setSnapshot(loadPatientNotes());
  };
  const refreshDocuments = (): void => {
    void props.core.listDocuments().then((result) => {
      if (result.ok) setDocuments(result.value);
    });
  };

  let clockTimer: ReturnType<typeof setInterval> | undefined;
  onMount(() => {
    refresh();
    refreshDocuments();
    void hydratePatientNotesFromIndexedDb()
      .then(refresh)
      .catch(() => console.warn('Не удалось восстановить заметки из IndexedDB.'));
    window.addEventListener(PATIENT_NOTES_EVENT, refresh);
    window.addEventListener(CONTENT_CHANGED_EVENT, refreshDocuments);
    clockTimer = setInterval(() => setClock(Date.now()), 30_000);
  });
  onCleanup(() => {
    window.removeEventListener(PATIENT_NOTES_EVENT, refresh);
    window.removeEventListener(CONTENT_CHANGED_EVENT, refreshDocuments);
    if (clockTimer) clearInterval(clockTimer);
  });

  const activeCard = (): PatientCard | null =>
    snapshot().cards.find((card) => card.id === activeCardId()) ?? null;
  const activeNote = (): PatientNote | null =>
    snapshot().notes.find((note) => note.id === activeNoteId()) ?? null;
  const reminderNote = (): PatientNote | null =>
    snapshot().notes.find((note) => note.id === reminderNoteId()) ?? null;
  const notesForCard = (cardId: string): readonly PatientNote[] =>
    snapshot()
      .notes.filter((note) => note.cardId === cardId)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  const documentTitle = (documentId: string): string | null =>
    documents().find((document) => document.id === documentId)?.title ?? null;
  const relatedDocuments = (
    note: PatientNote,
  ): readonly { readonly id: string; readonly title: string }[] =>
    note.relatedDocumentIds.flatMap((id) => {
      const title = documentTitle(id);
      return title ? [{ id, title }] : [];
    });

  const sortedCards = (): readonly PatientCard[] => {
    clock();
    return snapshot().cards.toSorted((left, right) => {
      const leftDue = notesForCard(left.id).some(
        (note) => note.reminder && isReminderDue(note.reminder),
      );
      const rightDue = notesForCard(right.id).some(
        (note) => note.reminder && isReminderDue(note.reminder),
      );
      if (leftDue !== rightDue) return leftDue ? -1 : 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    });
  };

  const openCard = (card: PatientCard): void => {
    setActiveCardId(card.id);
    setCardTitleDraft(card.title);
    setCardSummaryDraft(card.summary);
    setNoteDraft('');
    setEditingCard(false);
  };

  const openNote = (note: PatientNote): void => {
    setActiveNoteId(note.id);
    setEditNoteDraft(note.text);
    setEditingNote(false);
  };

  return (
    <section class="patient-notes-view page-surface" aria-label="Личные заметки">
      <header class="patient-notes-heading">
        <div>
          <p class="archive-kicker">Личный слой, только на этом устройстве</p>
          <h1>Заметки</h1>
          <p>
            Не официальный источник: записи не покидают устройство и в поиске помечены как личные.
          </p>
        </div>
      </header>

      <Show
        when={snapshot().cards.length > 0}
        fallback={
          <p class="patient-notes-empty paper-card">
            Пока нет карточек. Создайте первую, чтобы вести записи по пациенту.
          </p>
        }
      >
        <div class="patient-card-list">
          <For each={sortedCards()}>
            {(card) => {
              const notes = () => notesForCard(card.id);
              const due = () =>
                notes().some((note) => note.reminder && isReminderDue(note.reminder));
              return (
                <button
                  type="button"
                  class="patient-card paper-card"
                  classList={{ 'has-due-reminder': due() }}
                  onClick={() => openCard(card)}
                >
                  <span class="patient-card-title">{card.title}</span>
                  <Show when={card.summary}>
                    <p>{card.summary}</p>
                  </Show>
                  <small>
                    {notes().length} зап. · {formatDate(card.updatedAt)}
                  </small>
                </button>
              );
            }}
          </For>
        </div>
      </Show>

      <button
        class="patient-notes-fab"
        type="button"
        aria-label="Создать карточку"
        title="Новая карточка"
        onClick={() => setCreating(true)}
      >
        <span aria-hidden="true">+</span>
      </button>

      <OverlayDialog
        open={creating()}
        title="Новая карточка"
        subtitle="Личная заметка на этом устройстве"
        class="patient-card-dialog"
        onClose={() => setCreating(false)}
      >
        <form
          class="patient-note-form patient-card-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            const title = event.currentTarget.elements.namedItem('title');
            if (title instanceof HTMLInputElement) createPatientCard(title.value);
            setCreating(false);
          }}
        >
          <input
            name="title"
            placeholder="ФИО или название заметки"
            aria-label="Название карточки"
            required
          />
          <div class="patient-note-form-actions">
            <button type="submit">Создать</button>
          </div>
        </form>
      </OverlayDialog>

      <OverlayDialog
        open={activeCard() !== null}
        title={activeCard()?.title ?? 'Карточка'}
        subtitle={activeCard() ? `Обновлено ${formatDate(activeCard()?.updatedAt ?? '')}` : ''}
        class="patient-card-detail-dialog"
        onClose={() => setActiveCardId(null)}
      >
        <Show when={activeCard()}>
          {(card) => (
            <div class="patient-card-detail">
              <Show
                when={editingCard()}
                fallback={
                  <div class="patient-card-summary">
                    <Show when={card().summary}>
                      <p>{card().summary}</p>
                    </Show>
                    <div class="patient-note-actions">
                      <button type="button" onClick={() => setEditingCard(true)}>
                        Изменить карточку
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(`Удалить карточку «${card().title}» и все её записи?`)
                          ) {
                            removePatientCard(card().id);
                            setActiveCardId(null);
                          }
                        }}
                      >
                        Удалить карточку
                      </button>
                    </div>
                  </div>
                }
              >
                <form
                  class="patient-note-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    updatePatientCard(card().id, {
                      title: cardTitleDraft(),
                      summary: cardSummaryDraft(),
                    });
                    setEditingCard(false);
                  }}
                >
                  <input
                    value={cardTitleDraft()}
                    onInput={(event) => setCardTitleDraft(event.currentTarget.value)}
                    aria-label="Название карточки"
                  />
                  <NoteTextArea
                    name="summary"
                    label="Контекст пациента"
                    value={cardSummaryDraft()}
                    onChange={setCardSummaryDraft}
                    placeholder="Контекст, аллергии, сопутствующие состояния"
                  />
                  <div class="patient-note-form-actions">
                    <button type="submit">Сохранить</button>
                    <button type="button" onClick={() => setEditingCard(false)}>
                      Отмена
                    </button>
                  </div>
                </form>
              </Show>

              <div class="patient-note-timeline">
                <For each={notesForCard(card().id)}>
                  {(note) => (
                    <article class="patient-note-record">
                      <button type="button" onClick={() => openNote(note)}>
                        <small>{formatDate(note.createdAt)}</small>
                        <p>{note.text}</p>
                      </button>
                      <Show when={note.reminder}>
                        {(reminder) => (
                          <button
                            type="button"
                            class="note-reminder-link"
                            classList={{
                              due: isReminderDue(reminder()),
                              done: reminder().completedAt !== null,
                            }}
                            onClick={() => setReminderNoteId(note.id)}
                          >
                            {formatReminderDate(reminder())}
                            <Show when={reminder().completedAt !== null}> · выполнено</Show>
                          </button>
                        )}
                      </Show>
                    </article>
                  )}
                </For>
              </div>

              <form
                class="patient-note-form patient-note-add-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const due = reminderFieldsValue(event.currentTarget);
                  const next = addPatientNote(card().id, noteDraft());
                  const created = next.notes.at(-1);
                  if (created) {
                    if (due) setNoteReminder(created.id, due.dueAt, due.allDay);
                    deferEnrichment(created.id, props.core);
                  }
                  setNoteDraft('');
                  event.currentTarget.reset();
                }}
              >
                <NoteTextArea
                  name="text"
                  label={`Новая заметка для ${card().title}`}
                  value={noteDraft()}
                  onChange={setNoteDraft}
                  placeholder="Осмотр, назначение, динамика"
                />
                <ReminderFields />
                <div class="patient-note-form-actions">
                  <button type="submit">Добавить запись</button>
                </div>
              </form>
            </div>
          )}
        </Show>
      </OverlayDialog>

      <OverlayDialog
        open={activeNote() !== null}
        title={activeNote() ? `Запись от ${formatDate(activeNote()?.createdAt ?? '')}` : 'Запись'}
        subtitle={activeCard()?.title ?? ''}
        class="patient-note-detail-dialog"
        onClose={() => setActiveNoteId(null)}
      >
        <Show when={activeNote()}>
          {(note) => (
            <Show
              when={editingNote()}
              fallback={
                <div class="patient-note-detail">
                  <p>{note().text}</p>
                  <div class="patient-note-categories">
                    <For each={note().categories}>{(category) => <span>{category}</span>}</For>
                  </div>
                  <Show when={relatedDocuments(note()).length > 0}>
                    <div class="patient-note-related">
                      <span>По теме:</span>
                      <For each={relatedDocuments(note())}>
                        {(document) => (
                          <button type="button" onClick={() => openDocumentOverlay(document.id)}>
                            {document.title}
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                  <div class="patient-note-actions">
                    <button type="button" onClick={() => setEditingNote(true)}>
                      Изменить
                    </button>
                    <button type="button" onClick={() => setReminderNoteId(note().id)}>
                      {note().reminder ? 'Напоминание' : 'Добавить напоминание'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        removePatientNote(note().id);
                        setActiveNoteId(null);
                      }}
                    >
                      <AppGlyph name="trash" /> Удалить
                    </button>
                  </div>
                </div>
              }
            >
              <form
                class="patient-note-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  updatePatientNote(note().id, editNoteDraft());
                  deferEnrichment(note().id, props.core);
                  setEditingNote(false);
                }}
              >
                <NoteTextArea
                  name="text"
                  label="Текст заметки"
                  value={editNoteDraft()}
                  onChange={setEditNoteDraft}
                />
                <div class="patient-note-form-actions">
                  <button type="submit">Сохранить</button>
                  <button type="button" onClick={() => setEditingNote(false)}>
                    Отмена
                  </button>
                </div>
              </form>
            </Show>
          )}
        </Show>
      </OverlayDialog>

      <OverlayDialog
        open={reminderNote() !== null}
        title="Напоминание"
        subtitle={reminderNote()?.text.slice(0, 80) ?? ''}
        class="reminder-dialog"
        onClose={() => setReminderNoteId(null)}
      >
        <Show when={reminderNote()}>
          {(note) => (
            <div class="reminder-dialog-body">
              <Show
                when={note().reminder}
                fallback={
                  <form
                    class="patient-note-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const due = reminderFieldsValue(event.currentTarget);
                      if (due) setNoteReminder(note().id, due.dueAt, due.allDay);
                      setReminderNoteId(null);
                    }}
                  >
                    <ReminderFields />
                    <div class="patient-note-form-actions">
                      <button type="submit">Установить</button>
                    </div>
                  </form>
                }
              >
                {(reminder) => (
                  <Show
                    when={reminder().completedAt === null}
                    fallback={
                      <p>
                        Выполнено {formatDate(reminder().completedAt ?? '')}
                        <Show when={reminder().completionNote}> — {reminder().completionNote}</Show>
                      </p>
                    }
                  >
                    <p class="reminder-dialog-due" classList={{ due: isReminderDue(reminder()) }}>
                      Срок: {formatReminderDate(reminder())}
                    </p>
                    <form
                      class="patient-note-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        completeNoteReminder(note().id, completionDraft());
                        setCompletionDraft('');
                        setReminderNoteId(null);
                      }}
                    >
                      <NoteTextArea
                        name="completion"
                        label="Чем закрыто напоминание"
                        value={completionDraft()}
                        onChange={setCompletionDraft}
                        placeholder="Состояние, результат, условие завершения"
                      />
                      <div class="patient-note-form-actions">
                        <button type="submit">Выполнено</button>
                      </div>
                    </form>
                    <form
                      class="patient-note-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const due = reminderFieldsValue(event.currentTarget);
                        if (due) setNoteReminder(note().id, due.dueAt, due.allDay);
                        setReminderNoteId(null);
                      }}
                    >
                      <span class="reminder-dialog-hint">Перенести на более поздний срок</span>
                      <ReminderFields />
                      <div class="patient-note-form-actions">
                        <button type="submit">Перенести</button>
                      </div>
                    </form>
                  </Show>
                )}
              </Show>
            </div>
          )}
        </Show>
      </OverlayDialog>
    </section>
  );
}
