import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import {
  addPatientNote,
  childNotes,
  completeNoteReminder,
  createPatientCard,
  isReminderDue,
  loadPatientNotes,
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
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatReminderDate(dueAt: string, allDay: boolean): string {
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return dueAt;
  return new Intl.DateTimeFormat(
    'ru-RU',
    allDay
      ? { day: '2-digit', month: 'short' }
      : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' },
  ).format(date);
}

/**
 * Turns the inline date (+ optional time) fields into a concrete moment. A date-only reminder for
 * today means "due now", not midnight that already passed — the store rejects past moments.
 */
function composeDueAt(
  dateValue: string,
  timeValue: string,
): { dueAt: string; allDay: boolean } | null {
  if (!dateValue) return null;
  if (timeValue) {
    const withTime = new Date(`${dateValue}T${timeValue}`);
    return Number.isNaN(withTime.getTime())
      ? null
      : { dueAt: withTime.toISOString(), allDay: false };
  }
  const startOfDay = new Date(`${dateValue}T00:00`);
  if (Number.isNaN(startOfDay.getTime())) return null;
  const dueAt = startOfDay.getTime() <= Date.now() ? new Date(Date.now() + 60_000) : startOfDay;
  return { dueAt: dueAt.toISOString(), allDay: true };
}

function reminderFieldsValue(form: HTMLFormElement): { dueAt: string; allDay: boolean } | null {
  const date = form.elements.namedItem('reminder-date');
  const time = form.elements.namedItem('reminder-time');
  return composeDueAt(
    date instanceof HTMLInputElement ? date.value : '',
    time instanceof HTMLInputElement ? time.value : '',
  );
}

function ReminderFields(): JSX.Element {
  return (
    <div class="note-reminder-fields">
      <span>Напомнить:</span>
      <input type="date" name="reminder-date" aria-label="Дата напоминания" />
      <input type="time" name="reminder-time" aria-label="Время напоминания" />
    </div>
  );
}

function ReminderLink(props: {
  readonly note: PatientNote;
  readonly onManage: (noteId: string) => void;
}): JSX.Element {
  const reminder = () => props.note.reminder;
  return (
    <Show when={reminder()}>
      {(value) => (
        <button
          type="button"
          class="note-reminder-link"
          classList={{
            due: isReminderDue(value()),
            done: value().completedAt !== null,
          }}
          onClick={() => props.onManage(props.note.id)}
        >
          ⏰ {formatReminderDate(value().dueAt, value().allDay)}
          <Show when={value().completedAt !== null}> · выполнено</Show>
        </button>
      )}
    </Show>
  );
}

function NoteBranch(props: {
  readonly snapshot: PatientNotesSnapshot;
  readonly cardId: string;
  readonly parentNoteId: string | null;
  readonly depth: number;
  readonly onManageReminder: (noteId: string) => void;
}): JSX.Element {
  const [replyTo, setReplyTo] = createSignal<string>();
  const [editing, setEditing] = createSignal<string>();
  const notes = (): readonly ReturnType<typeof childNotes>[number][] => [
    ...childNotes(props.snapshot, props.cardId, props.parentNoteId),
  ];

  return (
    <Show when={notes().length > 0}>
      <ul class="patient-note-branch" classList={{ nested: props.depth > 0 }}>
        <For each={notes()}>
          {(note) => (
            <li class="patient-note">
              <Show
                when={editing() === note.id}
                fallback={
                  <div class="patient-note-body">
                    <p>{note.text}</p>
                    <div class="patient-note-actions">
                      <small>{formatDate(note.updatedAt)}</small>
                      <ReminderLink note={note} onManage={props.onManageReminder} />
                      <Show when={!note.reminder}>
                        <button type="button" onClick={() => props.onManageReminder(note.id)}>
                          Напоминание
                        </button>
                      </Show>
                      <button type="button" onClick={() => setReplyTo(note.id)}>
                        Уточнить
                      </button>
                      <button type="button" onClick={() => setEditing(note.id)}>
                        Изменить
                      </button>
                      <button
                        type="button"
                        aria-label={`Удалить заметку: ${note.text.slice(0, 40)}`}
                        onClick={() => removePatientNote(note.id)}
                      >
                        <AppGlyph name="close" />
                      </button>
                    </div>
                  </div>
                }
              >
                <form
                  class="patient-note-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const field = event.currentTarget.elements.namedItem('text');
                    if (field instanceof HTMLTextAreaElement)
                      updatePatientNote(note.id, field.value);
                    setEditing(undefined);
                  }}
                >
                  <textarea name="text" rows={3} value={note.text} aria-label="Текст заметки" />
                  <div class="patient-note-form-actions">
                    <button type="submit">Сохранить</button>
                    <button type="button" onClick={() => setEditing(undefined)}>
                      Отмена
                    </button>
                  </div>
                </form>
              </Show>

              <Show when={replyTo() === note.id}>
                <form
                  class="patient-note-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const field = form.elements.namedItem('text');
                    const due = reminderFieldsValue(form);
                    if (field instanceof HTMLTextAreaElement) {
                      const snapshot = addPatientNote(props.cardId, field.value, note.id);
                      const created = snapshot.notes.at(-1);
                      if (due && created) setNoteReminder(created.id, due.dueAt, due.allDay);
                    }
                    setReplyTo(undefined);
                  }}
                >
                  <textarea
                    name="text"
                    rows={2}
                    placeholder="Уточнение, динамика, результат"
                    aria-label="Вложенная заметка"
                  />
                  <ReminderFields />
                  <div class="patient-note-form-actions">
                    <button type="submit">Добавить</button>
                    <button type="button" onClick={() => setReplyTo(undefined)}>
                      Отмена
                    </button>
                  </div>
                </form>
              </Show>

              <NoteBranch
                snapshot={props.snapshot}
                cardId={props.cardId}
                parentNoteId={note.id}
                depth={props.depth + 1}
                onManageReminder={props.onManageReminder}
              />
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}

function CardPanel(props: {
  readonly card: PatientCard;
  readonly snapshot: PatientNotesSnapshot;
  readonly open: boolean;
  readonly onToggle: (open: boolean) => void;
  readonly onManageReminder: (noteId: string) => void;
}): JSX.Element {
  const [editingCard, setEditingCard] = createSignal(false);
  const noteCount = (): number =>
    props.snapshot.notes.filter((note) => note.cardId === props.card.id).length;
  const hasDueReminder = (): boolean =>
    props.snapshot.notes.some(
      (note) => note.cardId === props.card.id && note.reminder && isReminderDue(note.reminder),
    );

  return (
    // Every store change hands down fresh objects, so this element is rebuilt. Open state therefore
    // has to live above it, otherwise adding a note would collapse the card the doctor is writing in.
    <details
      class="patient-card paper-card"
      classList={{ 'has-due-reminder': hasDueReminder() }}
      open={props.open}
      onToggle={(event) => props.onToggle(event.currentTarget.open)}
    >
      <summary>
        <span class="patient-card-title">{props.card.title}</span>
        <small>
          {noteCount()} зап. · {formatDate(props.card.updatedAt)}
        </small>
      </summary>

      <Show
        when={editingCard()}
        fallback={
          <div class="patient-card-summary">
            <Show when={props.card.summary}>
              <p>{props.card.summary}</p>
            </Show>
            <div class="patient-note-actions">
              <button type="button" onClick={() => setEditingCard(true)}>
                Изменить карточку
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Удалить карточку «${props.card.title}» и все её заметки?`)) {
                    removePatientCard(props.card.id);
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
            const form = event.currentTarget;
            const title = form.elements.namedItem('title');
            const summary = form.elements.namedItem('summary');
            updatePatientCard(props.card.id, {
              ...(title instanceof HTMLInputElement ? { title: title.value } : {}),
              ...(summary instanceof HTMLTextAreaElement ? { summary: summary.value } : {}),
            });
            setEditingCard(false);
          }}
        >
          <input name="title" value={props.card.title} aria-label="Название карточки" />
          <textarea
            name="summary"
            rows={2}
            value={props.card.summary}
            aria-label="Контекст пациента"
          />
          <div class="patient-note-form-actions">
            <button type="submit">Сохранить</button>
            <button type="button" onClick={() => setEditingCard(false)}>
              Отмена
            </button>
          </div>
        </form>
      </Show>

      <NoteBranch
        snapshot={props.snapshot}
        cardId={props.card.id}
        parentNoteId={null}
        depth={0}
        onManageReminder={props.onManageReminder}
      />

      <form
        class="patient-note-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const field = form.elements.namedItem('text');
          const due = reminderFieldsValue(form);
          if (field instanceof HTMLTextAreaElement) {
            const snapshot = addPatientNote(props.card.id, field.value);
            const created = snapshot.notes.at(-1);
            if (due && created) setNoteReminder(created.id, due.dueAt, due.allDay);
            field.value = '';
            form.reset();
          }
        }}
      >
        <textarea
          name="text"
          rows={2}
          placeholder="Осмотр, назначение, динамика"
          aria-label={`Новая заметка для ${props.card.title}`}
        />
        <ReminderFields />
        <div class="patient-note-form-actions">
          <button type="submit">Добавить запись</button>
        </div>
      </form>
    </details>
  );
}

export function NotesView(): JSX.Element {
  const [snapshot, setSnapshot] = createSignal<PatientNotesSnapshot>({ cards: [], notes: [] });
  const [creating, setCreating] = createSignal(false);
  const [openCardIds, setOpenCardIds] = createSignal<readonly string[]>([]);
  const [manageNoteId, setManageNoteId] = createSignal<string | null>(null);
  // Due-ness is a function of the clock, so re-render periodically even without edits.
  const [clock, setClock] = createSignal(Date.now());

  const setCardOpen = (cardId: string, open: boolean): void => {
    setOpenCardIds((current) =>
      open ? [...new Set([...current, cardId])] : current.filter((id) => id !== cardId),
    );
  };

  const refresh = (): void => {
    setSnapshot(loadPatientNotes());
  };

  let clockTimer: ReturnType<typeof setInterval> | undefined;
  onMount(() => {
    refresh();
    window.addEventListener(PATIENT_NOTES_EVENT, refresh);
    clockTimer = setInterval(() => setClock(Date.now()), 30_000);
  });
  onCleanup(() => {
    window.removeEventListener(PATIENT_NOTES_EVENT, refresh);
    if (clockTimer) clearInterval(clockTimer);
  });

  const managedNote = (): PatientNote | null =>
    snapshot().notes.find((note) => note.id === manageNoteId()) ?? null;

  // Cards carrying a due follow-up float to the top; the rest keep creation order.
  const sortedCards = (): readonly PatientCard[] => {
    clock();
    const earliestDue = new Map<string, string>();
    for (const note of snapshot().notes) {
      if (!note.reminder || !isReminderDue(note.reminder)) continue;
      const current = earliestDue.get(note.cardId);
      if (!current || note.reminder.dueAt < current)
        earliestDue.set(note.cardId, note.reminder.dueAt);
    }
    return snapshot().cards.toSorted((left, right) => {
      const leftDue = earliestDue.get(left.id);
      const rightDue = earliestDue.get(right.id);
      if (leftDue && rightDue) return leftDue.localeCompare(rightDue);
      if (leftDue) return -1;
      if (rightDue) return 1;
      return 0;
    });
  };

  return (
    <section class="patient-notes-view" aria-label="Личные заметки">
      <header class="patient-notes-heading">
        <div>
          <p class="archive-kicker">Личный слой, только на этом устройстве</p>
          <h1>Заметки</h1>
          <p>
            Не официальный источник: записи не покидают устройство и в поиске помечены как личные.
          </p>
        </div>
        <button
          class="patient-notes-add"
          type="button"
          onClick={() => setCreating((current) => !current)}
        >
          {creating() ? 'Отмена' : 'Новая карточка'}
        </button>
      </header>

      <Show when={creating()}>
        <form
          class="patient-note-form paper-card"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const title = form.elements.namedItem('title');
            const summary = form.elements.namedItem('summary');
            if (title instanceof HTMLInputElement) {
              createPatientCard(
                title.value,
                summary instanceof HTMLTextAreaElement ? summary.value : '',
              );
            }
            setCreating(false);
          }}
        >
          <input
            name="title"
            placeholder="Фамилия И., возраст, вес"
            aria-label="Название карточки"
            required
          />
          <textarea
            name="summary"
            rows={2}
            placeholder="Аллергии, сопутствующие состояния, отделение"
            aria-label="Контекст пациента"
          />
          <div class="patient-note-form-actions">
            <button type="submit">Создать</button>
          </div>
        </form>
      </Show>

      <Show
        when={snapshot().cards.length > 0}
        fallback={
          <p class="patient-notes-empty paper-card">
            Пока нет карточек. Создайте первую, чтобы вести записи по пациенту и находить их в
            поиске.
          </p>
        }
      >
        <div class="patient-card-list">
          <For each={sortedCards()}>
            {(card) => (
              <CardPanel
                card={card}
                snapshot={snapshot()}
                open={openCardIds().includes(card.id)}
                onToggle={(open) => setCardOpen(card.id, open)}
                onManageReminder={setManageNoteId}
              />
            )}
          </For>
        </div>
      </Show>

      <OverlayDialog
        open={managedNote() !== null}
        title="Напоминание"
        subtitle={managedNote()?.text.slice(0, 80) ?? ''}
        class="reminder-dialog"
        onClose={() => setManageNoteId(null)}
      >
        <Show when={managedNote()}>
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
                      setManageNoteId(null);
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
                      <div class="reminder-dialog-done">
                        <p>
                          Выполнено {formatDate(reminder().completedAt ?? '')}
                          <Show when={reminder().completionNote}>
                            {' '}
                            — {reminder().completionNote}
                          </Show>
                        </p>
                      </div>
                    }
                  >
                    <p class="reminder-dialog-due" classList={{ due: isReminderDue(reminder()) }}>
                      Срок: {formatReminderDate(reminder().dueAt, reminder().allDay)}
                    </p>

                    <form
                      class="patient-note-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = event.currentTarget;
                        const field = form.elements.namedItem('completion');
                        completeNoteReminder(
                          note().id,
                          field instanceof HTMLTextAreaElement ? field.value : '',
                        );
                        setManageNoteId(null);
                      }}
                    >
                      <textarea
                        name="completion"
                        rows={2}
                        placeholder="Состояние, результат, условие завершения"
                        aria-label="Чем закрыто напоминание"
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
                        setManageNoteId(null);
                      }}
                    >
                      <span class="reminder-dialog-hint">
                        Перенести можно только на более поздний срок.
                      </span>
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
