import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import {
  addPatientNote,
  childNotes,
  createPatientCard,
  loadPatientNotes,
  PATIENT_NOTES_EVENT,
  type PatientCard,
  type PatientNotesSnapshot,
  removePatientCard,
  removePatientNote,
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

function NoteBranch(props: {
  readonly snapshot: PatientNotesSnapshot;
  readonly cardId: string;
  readonly parentNoteId: string | null;
  readonly depth: number;
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
                    const field = event.currentTarget.elements.namedItem('text');
                    if (field instanceof HTMLTextAreaElement) {
                      addPatientNote(props.cardId, field.value, note.id);
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
}): JSX.Element {
  const [editingCard, setEditingCard] = createSignal(false);
  const noteCount = (): number =>
    props.snapshot.notes.filter((note) => note.cardId === props.card.id).length;

  return (
    // Every store change hands down fresh objects, so this element is rebuilt. Open state therefore
    // has to live above it, otherwise adding a note would collapse the card the doctor is writing in.
    <details
      class="patient-card"
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

      <NoteBranch snapshot={props.snapshot} cardId={props.card.id} parentNoteId={null} depth={0} />

      <form
        class="patient-note-form"
        onSubmit={(event) => {
          event.preventDefault();
          const field = event.currentTarget.elements.namedItem('text');
          if (field instanceof HTMLTextAreaElement) {
            addPatientNote(props.card.id, field.value);
            field.value = '';
          }
        }}
      >
        <textarea
          name="text"
          rows={2}
          placeholder="Осмотр, назначение, динамика"
          aria-label={`Новая заметка для ${props.card.title}`}
        />
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

  const setCardOpen = (cardId: string, open: boolean): void => {
    setOpenCardIds((current) =>
      open ? [...new Set([...current, cardId])] : current.filter((id) => id !== cardId),
    );
  };

  const refresh = (): void => {
    setSnapshot(loadPatientNotes());
  };

  onMount(() => {
    refresh();
    window.addEventListener(PATIENT_NOTES_EVENT, refresh);
  });
  onCleanup(() => window.removeEventListener(PATIENT_NOTES_EVENT, refresh));

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
          <For each={snapshot().cards}>
            {(card) => (
              <CardPanel
                card={card}
                snapshot={snapshot()}
                open={openCardIds().includes(card.id)}
                onToggle={(open) => setCardOpen(card.id, open)}
              />
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
