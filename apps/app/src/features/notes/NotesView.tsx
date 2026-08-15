import { TextField } from '@kobalte/core/text-field';
import type { MedicalCore, MedicalDocumentSummary } from '@localmed/contracts';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SearchField } from '@/components/SearchField';
import { NoteImagePicker } from '@/features/notes/NoteImages';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { openDocumentOverlay } from '@/state/document-navigation';
import {
  addNoteImages,
  loadNoteImages,
  loadNoteImagesForNotes,
  NOTE_IMAGES_EVENT,
  type NoteImage,
} from '@/state/note-images';
import {
  addPatientNote,
  completeNoteReminder,
  createPatientCard,
  enrichPatientNote,
  hydratePatientNotesFromIndexedDb,
  injectColleagueNote,
  isReminderDue,
  loadPatientNoteDraft,
  loadPatientNotes,
  loadPreviousPatientNoteRevision,
  type NoteReminder,
  PATIENT_NOTES_EVENT,
  type PatientCard,
  type PatientNote,
  type PatientNotesSnapshot,
  removePatientCard,
  removePatientNote,
  removePatientNoteDraft,
  savePatientNoteDraft,
  searchPatientNotes,
  setNoteReminder,
  updatePatientCard,
  updatePatientNote,
} from '@/state/patient-notes';
import { requestReminderNotificationPermission } from '@/state/reminder-notifications';

type NotesRoute =
  | { readonly kind: 'index' }
  | { readonly kind: 'card'; readonly cardId: string }
  | { readonly kind: 'new-record'; readonly cardId: string }
  | { readonly kind: 'record'; readonly cardId: string; readonly noteId: string };

type DeleteTarget =
  | {
      readonly kind: 'card';
      readonly id: string;
      readonly title: string;
      readonly returnPath: string | null;
    }
  | {
      readonly kind: 'note';
      readonly id: string;
      readonly title: string;
      readonly returnPath: string;
    };

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
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return null;
  return { dueAt: date.toISOString(), allDay: !timeValue };
}

function reminderInputValues(reminder?: NoteReminder): {
  readonly date: string;
  readonly time: string;
} {
  if (!reminder) return { date: '', time: '' };
  const value = new Date(reminder.dueAt);
  if (Number.isNaN(value.getTime())) return { date: '', time: '' };
  const pad = (part: number): string => String(part).padStart(2, '0');
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: reminder.allDay ? '' : `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  };
}

function readNotesRoute(): NotesRoute {
  const parts = window.location.hash.replace(/^#\/?/u, '').split('/');
  if (parts[0] !== 'notes' || !parts[1]) return { kind: 'index' };
  let cardId: string;
  try {
    cardId = decodeURIComponent(parts[1]);
  } catch {
    return { kind: 'index' };
  }
  if (parts.length === 2) return { kind: 'card', cardId };
  if (parts[2] !== 'records' || !parts[3]) return { kind: 'card', cardId };
  if (parts[3] === 'new') return { kind: 'new-record', cardId };
  try {
    return { kind: 'record', cardId, noteId: decodeURIComponent(parts[3]) };
  } catch {
    return { kind: 'card', cardId };
  }
}

function notesPath(cardId?: string, noteId?: string): string {
  if (!cardId) return '#/notes';
  const card = encodeURIComponent(cardId);
  if (!noteId) return `#/notes/${card}`;
  return `#/notes/${card}/records/${encodeURIComponent(noteId)}`;
}

function NoteTextArea(props: {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
}): JSX.Element {
  return (
    <TextField
      name={props.name}
      value={props.value}
      onChange={props.onChange}
      {...(props.disabled ? { disabled: true } : {})}
    >
      <TextField.Label class="visually-hidden">{props.label}</TextField.Label>
      <TextField.TextArea
        class="patient-note-form__textarea"
        autoResize
        aria-label={props.label}
        disabled={props.disabled}
        placeholder={props.placeholder}
        rows={4}
      />
    </TextField>
  );
}

function ReminderFields(props: {
  readonly date: string;
  readonly time: string;
  readonly notificationMessage: string;
  readonly onDateChange: (value: string) => void;
  readonly onTimeChange: (value: string) => void;
}): JSX.Element {
  return (
    <div class="note-reminder-fields">
      <span>Напомнить</span>
      <input
        type="date"
        aria-label="Дата напоминания"
        value={props.date}
        onInput={(event) => props.onDateChange(event.currentTarget.value)}
      />
      <input
        type="time"
        aria-label="Время напоминания"
        value={props.time}
        onInput={(event) => props.onTimeChange(event.currentTarget.value)}
      />
      <Show when={props.notificationMessage}>
        <small class="note-notification-message">{props.notificationMessage}</small>
      </Show>
    </div>
  );
}

function deferEnrichment(noteId: string, core: MedicalCore, onSettled?: () => void): void {
  window.setTimeout(() => {
    void enrichPatientNote(noteId, core).finally(() => onSettled?.());
  }, 0);
}

export function NotesView(props: {
  readonly core: MedicalCore;
  readonly active: boolean;
}): JSX.Element {
  const [snapshot, setSnapshot] = createSignal<PatientNotesSnapshot>({ cards: [], notes: [] });
  const [documents, setDocuments] = createSignal<readonly MedicalDocumentSummary[]>([]);
  const [route, setRoute] = createSignal<NotesRoute>(readNotesRoute());
  const [creating, setCreating] = createSignal(false);
  const [editingCard, setEditingCard] = createSignal(false);
  const [deleteTarget, setDeleteTarget] = createSignal<DeleteTarget | null>(null);
  const [reminderNoteId, setReminderNoteId] = createSignal<string | null>(null);
  const [cardTitleDraft, setCardTitleDraft] = createSignal('');
  const [cardSummaryDraft, setCardSummaryDraft] = createSignal('');
  const [notesSearchQuery, setNotesSearchQuery] = createSignal('');
  const [noteDraft, setNoteDraft] = createSignal('');
  const [reminderDate, setReminderDate] = createSignal('');
  const [reminderTime, setReminderTime] = createSignal('');
  const [notificationMessage, setNotificationMessage] = createSignal('');
  const [noteImages, setNoteImages] = createSignal<readonly NoteImage[]>([]);
  const [recordImages, setRecordImages] = createSignal<ReadonlyMap<string, readonly NoteImage[]>>(
    new Map(),
  );
  const [imagesTick, setImagesTick] = createSignal(0);
  const [pendingImages, setPendingImages] = createSignal<readonly File[]>([]);
  const [imageError, setImageError] = createSignal('');
  const [draftRecovered, setDraftRecovered] = createSignal(false);
  const [showPreviousRevision, setShowPreviousRevision] = createSignal(false);
  const [relatedDocumentsLoading, setRelatedDocumentsLoading] = createSignal(false);
  const [completionDraft, setCompletionDraft] = createSignal('');
  const [clock, setClock] = createSignal(Date.now());
  let editorKey = '';
  let editorReadyKey = '';

  const refresh = (): void => {
    setSnapshot(loadPatientNotes());
  };
  const refreshDocuments = (): void => {
    void props.core.listDocuments().then((result) => {
      if (result.ok) setDocuments(result.value);
    });
  };
  const handleHashChange = (): void => {
    commitEditor();
    setRoute(readNotesRoute());
    setEditingCard(false);
    setReminderNoteId(null);
    setPendingImages([]);
    setImageError('');
    setDraftRecovered(false);
    setShowPreviousRevision(false);
    setRelatedDocumentsLoading(false);
  };
  const refreshImages = (): void => {
    setImagesTick((tick) => tick + 1);
    const note = activeNote();
    if (!note) {
      setNoteImages([]);
      return;
    }
    void loadNoteImages(note.id)
      .then(setNoteImages)
      .catch(() => setImageError('Не удалось загрузить изображения.'));
  };
  let clockTimer: ReturnType<typeof setInterval> | undefined;
  onMount(() => {
    refresh();
    refreshDocuments();
    void hydratePatientNotesFromIndexedDb()
      .catch(() => console.warn('Не удалось восстановить заметки из IndexedDB.'))
      .finally(() => {
        injectColleagueNote();
        refresh();
      });
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener(PATIENT_NOTES_EVENT, refresh);
    window.addEventListener(CONTENT_CHANGED_EVENT, refreshDocuments);
    window.addEventListener(NOTE_IMAGES_EVENT, refreshImages);
    clockTimer = setInterval(() => setClock(Date.now()), 30_000);
  });
  onCleanup(() => {
    window.removeEventListener('hashchange', handleHashChange);
    window.removeEventListener(PATIENT_NOTES_EVENT, refresh);
    window.removeEventListener(CONTENT_CHANGED_EVENT, refreshDocuments);
    window.removeEventListener(NOTE_IMAGES_EVENT, refreshImages);
    if (clockTimer) clearInterval(clockTimer);
  });

  const routeCardId = (): string | null => {
    const current = route();
    return current.kind === 'index' ? null : current.cardId;
  };
  const activeCard = (): PatientCard | null =>
    snapshot().cards.find((card) => card.id === routeCardId()) ?? null;
  const activeNote = (): PatientNote | null => {
    const current = route();
    if (current.kind !== 'record') return null;
    return (
      snapshot().notes.find(
        (note) => note.id === current.noteId && note.cardId === current.cardId,
      ) ?? null
    );
  };
  const previousRevision = createMemo(() => {
    const note = activeNote();
    return note ? loadPreviousPatientNoteRevision(note.id) : null;
  });
  const previousRevisionDiffers = createMemo(() => {
    const revision = previousRevision();
    const note = activeNote();
    return Boolean(revision && note && revision.text !== noteDraft().trim());
  });
  const viewingPreviousRevision = createMemo(
    () => showPreviousRevision() && previousRevisionDiffers(),
  );
  const editorCard = (): PatientCard | null => {
    const card = activeCard();
    if (!card) return null;
    return route().kind === 'new-record' || activeNote() ? card : null;
  };
  const reminderNote = (): PatientNote | null =>
    snapshot().notes.find((note) => note.id === reminderNoteId()) ?? null;
  const notesForCard = (cardId: string): readonly PatientNote[] =>
    snapshot()
      .notes.filter((note) => note.cardId === cardId)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));

  createEffect(() => {
    imagesTick();
    const cardId = routeCardId();
    const ids = cardId ? notesForCard(cardId).map((note) => note.id) : [];
    if (ids.length === 0) {
      setRecordImages(new Map());
      return;
    }
    void loadNoteImagesForNotes(ids).then(setRecordImages);
  });
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
  const visibleCards = createMemo(() => {
    const cards = sortedCards();
    const query = notesSearchQuery().trim();
    if (!query) return cards;
    const matchingCardIds = new Set(
      searchPatientNotes(query, Number.MAX_SAFE_INTEGER).map((match) => match.card.id),
    );
    return cards.filter((card) => matchingCardIds.has(card.id));
  });

  const navigate = (path: string): void => {
    window.location.hash = path;
  };
  const confirmDelete = (): void => {
    const target = deleteTarget();
    if (!target) return;
    if (target.kind === 'card') removePatientCard(target.id);
    else removePatientNote(target.id);
    if (target.returnPath) navigate(target.returnPath);
    setDeleteTarget(null);
  };
  const openCardEditor = (card: PatientCard): void => {
    setCardTitleDraft(card.title);
    setCardSummaryDraft(card.summary);
    setEditingCard(true);
  };
  const openReminder = (note: PatientNote): void => {
    setReminderNoteId(note.id);
    setCompletionDraft('');
  };
  const enableReminderNotification = async (): Promise<boolean> => {
    try {
      const result = await requestReminderNotificationPermission();
      setNotificationMessage(result.message);
      return result.granted;
    } catch {
      setNotificationMessage('Не удалось запросить разрешение на уведомления.');
      return false;
    }
  };
  const reminderValue = (): { dueAt: string; allDay: boolean } | null => {
    const value = composeDueAt(reminderDate(), reminderTime());
    const existing = activeNote()?.reminder;
    if (
      !value ||
      (existing &&
        existing.completedAt === null &&
        new Date(value.dueAt).getTime() < new Date(existing.dueAt).getTime())
    ) {
      return null;
    }
    return value;
  };

  const persistEditorImages = (noteId: string, files: readonly File[]): void => {
    if (files.length === 0) return;
    void addNoteImages(noteId, files)
      .then(() => {
        if (activeNote()?.id === noteId) refreshImages();
      })
      .catch((cause) => {
        setImageError(cause instanceof Error ? cause.message : 'Не удалось сохранить изображения.');
      });
  };

  function commitEditor(): void {
    const current = route();
    if (current.kind !== 'new-record' && current.kind !== 'record') return;
    const card = activeCard();
    const text = noteDraft().trim();
    const reminder = reminderValue();
    const files = pendingImages();
    if (!card) return;

    if (current.kind === 'record') {
      const note = activeNote();
      if (!note) return;
      if (text && note.text !== text) {
        updatePatientNote(note.id, text);
        deferEnrichment(note.id, props.core, () => setRelatedDocumentsLoading(false));
      }
      if (
        reminder &&
        (!note.reminder ||
          note.reminder.dueAt !== reminder.dueAt ||
          note.reminder.allDay !== reminder.allDay)
      ) {
        setNoteReminder(
          note.id,
          reminder.dueAt,
          reminder.allDay,
          note.reminder?.notificationEnabled,
        );
      }
      removePatientNoteDraft(note.id);
      setPendingImages([]);
      persistEditorImages(note.id, files);
      return;
    }

    if (!text) return;
    const next = addPatientNote(card.id, text);
    const created = next.notes.at(-1);
    if (!created) return;
    if (reminder) setNoteReminder(created.id, reminder.dueAt, reminder.allDay);
    removePatientNoteDraft(`new:${card.id}`);
    setPendingImages([]);
    persistEditorImages(created.id, files);
    deferEnrichment(created.id, props.core);
  }

  const restorePreviousRevision = (): void => {
    const revision = previousRevision();
    if (!revision) return;
    setNoteDraft(revision.text);
    setDraftRecovered(false);
    setShowPreviousRevision(false);
    setRelatedDocumentsLoading(true);
  };

  createEffect(() => {
    const current = route();
    if (current.kind === 'new-record') {
      const key = `new:${current.cardId}`;
      if (editorKey === key) return;
      editorKey = key;
      const draft = loadPatientNoteDraft(key);
      const useDraft = Boolean(
        draft && (draft.text.trim() || draft.reminderDate || draft.reminderTime),
      );
      if (draft && !useDraft) removePatientNoteDraft(key);
      setNoteDraft(useDraft && draft ? draft.text : '');
      setReminderDate(useDraft && draft ? draft.reminderDate : '');
      setReminderTime(useDraft && draft ? draft.reminderTime : '');
      setNotificationMessage('');
      setNoteImages([]);
      setPendingImages([]);
      setDraftRecovered(useDraft);
      setShowPreviousRevision(false);
      setRelatedDocumentsLoading(false);
      editorReadyKey = key;
      return;
    }
    if (current.kind === 'record') {
      const note = activeNote();
      if (!note || editorKey === note.id) return;
      editorKey = note.id;
      const draft = loadPatientNoteDraft(note.id);
      const reminder = reminderInputValues(note.reminder);
      const useDraft = Boolean(
        draft?.text.trim() &&
          (draft.text !== note.text ||
            draft.reminderDate !== reminder.date ||
            draft.reminderTime !== reminder.time),
      );
      if (draft && !useDraft) removePatientNoteDraft(note.id);
      setNoteDraft(useDraft && draft ? draft.text : note.text);
      setReminderDate(useDraft && draft ? draft.reminderDate : reminder.date);
      setReminderTime(useDraft && draft ? draft.reminderTime : reminder.time);
      setNotificationMessage('');
      setPendingImages([]);
      setDraftRecovered(useDraft);
      setShowPreviousRevision(false);
      setRelatedDocumentsLoading(false);
      refreshImages();
      editorReadyKey = note.id;
      return;
    }
    editorKey = '';
    editorReadyKey = '';
    setNoteImages([]);
  });

  createEffect(() => {
    const current = route();
    const noteId =
      current.kind === 'record'
        ? current.noteId
        : current.kind === 'new-record'
          ? `new:${current.cardId}`
          : null;
    if (!noteId || editorReadyKey !== noteId) return;
    savePatientNoteDraft({
      noteId,
      text: noteDraft(),
      reminderDate: reminderDate(),
      reminderTime: reminderTime(),
      savedAt: new Date().toISOString(),
    });
  });

  return (
    <section class="patient-notes-view page-surface page-grain" aria-label="Личные заметки">
      <Show when={props.active && route().kind === 'index'}>
        <header class="patient-notes-heading">
          <div>
            <p class="archive-kicker">Личный слой, только на этом устройстве</p>
            <h1>Заметки</h1>
          </div>
        </header>
        <SearchField
          class="notes-search"
          id="notes-search"
          value={notesSearchQuery()}
          onInput={setNotesSearchQuery}
          label="Поиск по заметкам"
          hideLabel
          placeholder="Поиск по заметкам"
        />

        <Show
          when={visibleCards().length > 0}
          fallback={
            <p class="patient-notes-empty paper-card">
              {notesSearchQuery().trim()
                ? 'По запросу ничего не найдено.'
                : 'Пока нет карточек. Создайте первую, чтобы вести записи по пациенту.'}
            </p>
          }
        >
          <div class="patient-card-list">
            <For each={visibleCards()}>
              {(card) => {
                const notes = () => notesForCard(card.id);
                const due = () =>
                  notes().some((note) => note.reminder && isReminderDue(note.reminder));
                return (
                  <article
                    class="patient-card paper-card"
                    classList={{ 'has-due-reminder': due() }}
                  >
                    <button
                      type="button"
                      class="patient-card-open"
                      onClick={() => navigate(notesPath(card.id))}
                    >
                      <span class="patient-card-title">{card.title}</span>
                      <Show when={card.summary}>
                        <p>{card.summary}</p>
                      </Show>
                      <small>
                        {notes().length} зап.
                        <br />
                        {formatDate(card.updatedAt)}
                      </small>
                    </button>
                    <div class="patient-card-corner-actions">
                      <button
                        type="button"
                        class="patient-card-icon-action danger"
                        aria-label={`Удалить карточку «${card.title}»`}
                        title="Удалить карточку"
                        onClick={() =>
                          setDeleteTarget({
                            kind: 'card',
                            id: card.id,
                            title: card.title,
                            returnPath: null,
                          })
                        }
                      >
                        <AppGlyph name="trash" class="patient-card-icon-action__icon" />
                      </button>
                    </div>
                  </article>
                );
              }}
            </For>
          </div>
        </Show>

        <Portal>
          <button
            class="patient-notes-fab"
            type="button"
            aria-label="Создать карточку"
            title="Новая карточка"
            onClick={() => setCreating(true)}
          >
            <span class="patient-notes-fab__icon" aria-hidden="true">
              +
            </span>
          </button>
        </Portal>
      </Show>

      <Show when={route().kind === 'card'}>
        <Show
          when={activeCard()}
          fallback={
            <div class="notes-route-missing paper-card">
              <p>Карточка не найдена.</p>
              <button type="button" onClick={() => navigate(notesPath())}>
                Вернуться к заметкам
              </button>
            </div>
          }
        >
          {(card) => (
            <>
              <header class="notes-route-heading">
                <button
                  class="knowledge-back-button"
                  type="button"
                  aria-label="Назад к заметкам"
                  onClick={() => navigate(notesPath())}
                >
                  <AppGlyph name="arrow-left" />
                </button>
                <div>
                  <h1>{card().title}</h1>
                  <Show when={card().summary}>
                    <p class="notes-route-summary">{card().summary}</p>
                  </Show>
                  <p>Обновлено {formatDate(card().updatedAt)}</p>
                </div>
                <div class="patient-note-actions">
                  <button
                    type="button"
                    class="patient-card-icon-action"
                    aria-label="Изменить карточку"
                    title="Изменить карточку"
                    onClick={() => openCardEditor(card())}
                  >
                    <AppGlyph name="edit" class="patient-card-icon-action__icon" />
                  </button>
                  <button
                    type="button"
                    class="patient-card-icon-action danger"
                    aria-label="Удалить карточку"
                    title="Удалить карточку"
                    onClick={() =>
                      setDeleteTarget({
                        kind: 'card',
                        id: card().id,
                        title: card().title,
                        returnPath: notesPath(),
                      })
                    }
                  >
                    <AppGlyph name="trash" class="patient-card-icon-action__icon" />
                  </button>
                </div>
              </header>
              <div class="patient-records-toolbar">
                <h2>Записи</h2>
                <button type="button" onClick={() => navigate(notesPath(card().id, 'new'))}>
                  Добавить запись
                </button>
              </div>
              <Show
                when={notesForCard(card().id).length > 0}
                fallback={<p class="patient-notes-empty paper-card">Записей пока нет.</p>}
              >
                <div class="patient-note-timeline">
                  <For each={notesForCard(card().id)}>
                    {(note) => (
                      <article class="patient-note-record">
                        <button
                          type="button"
                          onClick={() => navigate(notesPath(card().id, note.id))}
                        >
                          <small>{formatDate(note.createdAt)}</small>
                          <Show when={(recordImages().get(note.id)?.length ?? 0) > 0}>
                            <div class="patient-note-record-thumbnails">
                              <For each={recordImages().get(note.id)}>
                                {(image) => <img src={image.dataUrl} alt="" loading="lazy" />}
                              </For>
                            </div>
                          </Show>
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
                              onClick={() => openReminder(note)}
                            >
                              {formatReminderDate(reminder())}
                              <Show when={reminder().notificationEnabled}> · уведомление</Show>
                              <Show when={reminder().completedAt !== null}> · выполнено</Show>
                            </button>
                          )}
                        </Show>
                      </article>
                    )}
                  </For>
                </div>
              </Show>
            </>
          )}
        </Show>
      </Show>

      <Show when={route().kind === 'new-record' || route().kind === 'record'}>
        <Show
          when={editorCard()}
          fallback={
            <div class="notes-route-missing paper-card">
              <p>Карточка или запись не найдена.</p>
              <button type="button" onClick={() => navigate(notesPath())}>
                Вернуться к заметкам
              </button>
            </div>
          }
        >
          {(card) => {
            const editing = () => route().kind === 'record';
            const note = activeNote;
            return (
              <>
                <header class="notes-route-heading">
                  <button
                    class="notes-route-heading__back knowledge-back-button"
                    type="button"
                    aria-label="Назад к записям"
                    disabled={viewingPreviousRevision()}
                    onClick={() => navigate(notesPath(card().id))}
                  >
                    <AppGlyph name="arrow-left" />
                  </button>
                  <div>
                    <p class="notes-route-heading__eyebrow">
                      {editing() ? 'Редактировать запись' : 'Новая запись'}
                    </p>
                    <h1 class="notes-route-heading__title">{card().title}</h1>
                  </div>
                  <Show when={note()}>
                    {(currentNote) => (
                      <div class="notes-route-heading__actions">
                        <button
                          class="notes-route-heading__previous patient-card-icon-action"
                          classList={{
                            'notes-route-heading__previous--active': viewingPreviousRevision(),
                          }}
                          type="button"
                          aria-label={
                            viewingPreviousRevision()
                              ? 'Скрыть предыдущую редакцию'
                              : 'Показать предыдущую редакцию'
                          }
                          aria-expanded={viewingPreviousRevision()}
                          title={
                            viewingPreviousRevision()
                              ? 'Скрыть предыдущую редакцию'
                              : 'Предыдущая редакция'
                          }
                          disabled={!previousRevisionDiffers()}
                          onClick={() => setShowPreviousRevision((visible) => !visible)}
                        >
                          <AppGlyph name="share-fat" class="notes-route-heading__previous-icon" />
                        </button>
                        <button
                          class="notes-route-heading__delete patient-record-delete patient-card-icon-action danger"
                          type="button"
                          aria-label="Удалить запись"
                          title="Удалить запись"
                          disabled={viewingPreviousRevision()}
                          onClick={() =>
                            setDeleteTarget({
                              kind: 'note',
                              id: currentNote().id,
                              title: currentNote().text.slice(0, 80),
                              returnPath: notesPath(card().id),
                            })
                          }
                        >
                          <AppGlyph name="trash" class="patient-card-icon-action__icon" />
                        </button>
                      </div>
                    )}
                  </Show>
                </header>
                <Show when={note()}>
                  {(currentNote) => (
                    <div class="patient-note-categories notes-route-categories">
                      <span class="patient-note-categories-label">Теги:</span>
                      <For each={currentNote().categories}>
                        {(category) => <span>{category}</span>}
                      </For>
                    </div>
                  )}
                </Show>
                <div
                  class="patient-note-form patient-record-editor paper-card"
                  classList={{
                    'patient-record-editor--previous-revision': viewingPreviousRevision(),
                  }}
                >
                  <Show when={viewingPreviousRevision()}>
                    <div class="patient-note-previous-revision__banner">
                      <span class="patient-note-previous-revision__label">Предыдущая редакция</span>
                      <span class="patient-note-previous-revision__mode">Только просмотр</span>
                    </div>
                  </Show>
                  <Show when={draftRecovered() && !viewingPreviousRevision()}>
                    <p class="patient-note-autosave-status" role="status">
                      Черновик восстановлен
                    </p>
                  </Show>
                  <NoteTextArea
                    name="text"
                    label={editing() ? 'Текст записи' : `Новая заметка для ${card().title}`}
                    value={
                      viewingPreviousRevision()
                        ? (previousRevision()?.text ?? noteDraft())
                        : noteDraft()
                    }
                    onChange={setNoteDraft}
                    placeholder="Осмотр, назначение, динамика"
                    disabled={viewingPreviousRevision()}
                  />
                  <NoteImagePicker
                    files={pendingImages()}
                    images={noteImages()}
                    error={imageError()}
                    onFilesChange={setPendingImages}
                    onError={setImageError}
                    disabled={viewingPreviousRevision()}
                  />
                  <Show when={!editing()}>
                    <ReminderFields
                      date={reminderDate()}
                      time={reminderTime()}
                      notificationMessage={notificationMessage()}
                      onDateChange={setReminderDate}
                      onTimeChange={setReminderTime}
                    />
                  </Show>
                  <Show when={!viewingPreviousRevision()}>
                    <p class="patient-note-autosave-status">Сохраняется автоматически</p>
                  </Show>
                </div>

                <Show when={viewingPreviousRevision()}>
                  <div class="patient-note-previous-revision__restore">
                    <Button
                      class="patient-note-previous-revision__restore-button"
                      type="button"
                      variant="primary"
                      icon={
                        <AppGlyph
                          name="share-fat"
                          class="patient-note-previous-revision__restore-icon"
                        />
                      }
                      onClick={restorePreviousRevision}
                    >
                      Вернуть прошлую редакцию
                    </Button>
                  </div>
                </Show>

                <Show when={!viewingPreviousRevision() ? note() : null}>
                  {(currentNote) => (
                    <div class="patient-record-editor-aside">
                      <div class="record-reminder-editor paper-card">
                        <Show when={currentNote().reminder}>
                          {(reminder) => (
                            <button
                              type="button"
                              class="note-reminder-link"
                              classList={{
                                due: isReminderDue(reminder()),
                                done: reminder().completedAt !== null,
                              }}
                              onClick={() => openReminder(currentNote())}
                            >
                              {formatReminderDate(reminder())}
                              <Show when={reminder().notificationEnabled}> · уведомление</Show>
                              <Show when={reminder().completedAt !== null}> · выполнено</Show>
                            </button>
                          )}
                        </Show>
                        <ReminderFields
                          date={reminderDate()}
                          time={reminderTime()}
                          notificationMessage={notificationMessage()}
                          onDateChange={setReminderDate}
                          onTimeChange={setReminderTime}
                        />
                        <Button
                          class="patient-note-action patient-note-action--primary"
                          type="button"
                          variant="primary"
                          disabled={reminderValue() === null}
                          onClick={() => {
                            const reminder = reminderValue();
                            if (!reminder) return;
                            void enableReminderNotification().then((notificationGranted) => {
                              setNoteReminder(
                                currentNote().id,
                                reminder.dueAt,
                                reminder.allDay,
                                notificationGranted,
                              );
                            });
                          }}
                        >
                          {currentNote().reminder ? 'Сохранить' : 'Установить'}
                        </Button>
                      </div>
                      <Show
                        when={
                          relatedDocumentsLoading() || relatedDocuments(currentNote()).length > 0
                        }
                      >
                        <div class="patient-note-related paper-card">
                          <span>По теме:</span>
                          <Show
                            when={!relatedDocumentsLoading()}
                            fallback={
                              <span class="patient-note-related__loading" role="status">
                                Подбираем документы по теме…
                              </span>
                            }
                          >
                            <For each={relatedDocuments(currentNote())}>
                              {(document) => (
                                <button
                                  type="button"
                                  onClick={() => openDocumentOverlay(document.id)}
                                >
                                  {document.title}
                                </button>
                              )}
                            </For>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  )}
                </Show>
              </>
            );
          }}
        </Show>
      </Show>

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

      <ConfirmationDialog
        open={deleteTarget() !== null}
        title={deleteTarget()?.kind === 'card' ? 'Удалить карточку?' : 'Удалить запись?'}
        description={
          deleteTarget()?.kind === 'card'
            ? `Карточка «${deleteTarget()?.title}» и все её записи будут удалены с этого устройства. Отменить это действие нельзя.`
            : `Запись «${deleteTarget()?.title}» будет удалена с этого устройства. Отменить это действие нельзя.`
        }
        confirmLabel="Удалить"
        danger
        onConfirm={confirmDelete}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      />

      <OverlayDialog
        open={editingCard()}
        title="Изменить карточку"
        subtitle={activeCard()?.title ?? ''}
        class="patient-card-dialog"
        onClose={() => setEditingCard(false)}
      >
        <Show when={activeCard()}>
          {(card) => (
            <form
              class="patient-note-form patient-card-create-form"
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
        <Show when={reminderNote()?.reminder}>
          {(reminder) => (
            <div class="reminder-dialog-body">
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
                  <Show when={reminder().notificationEnabled}> · системное уведомление</Show>
                </p>
                <form
                  class="patient-note-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const note = reminderNote();
                    if (note) completeNoteReminder(note.id, completionDraft());
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
              </Show>
            </div>
          )}
        </Show>
      </OverlayDialog>
    </section>
  );
}
