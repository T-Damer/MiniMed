import { createEffect, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import { highlightStatusNote } from '@/features/library/highlight-status';
import { createDocumentHighlightStore } from '@/features/library/use-document-highlights';
import { DOCUMENT_NOTES_EVENT, loadDocumentNote, saveDocumentNote } from '@/state/document-notes';
import {
  removeUserHighlight,
  type UserDocumentHighlight,
  updateUserHighlightNote,
  userHighlightColor,
} from '@/state/user-library-highlights';

import '@/features/library/document-highlights-sheet.css';

const NOTE_AUTOSAVE_DELAY_MS = 400;

/** The text a row shows: the quote on one line of context, not the whole selection. */
function previewQuote(quote: string): string {
  const flat = quote.replace(/\s+/gu, ' ').trim();
  return flat.length > 220 ? `${flat.slice(0, 217)}…` : flat;
}

/**
 * Unified «Заметки и выделения» sheet for a document (Wave 2.2):
 * - document-level clinician note (autosaved locally per document);
 * - all text highlights with their attached personal notes and inline note editing;
 * - edition carry-over & missing-anchor indicators preserved from R1a.
 */
export function DocumentHighlightsSheet(props: {
  readonly documentId: string;
  readonly open: boolean;
  readonly onClose: () => void;
  /** Goes to a highlight that is on the page. */
  readonly onJump: (highlight: UserDocumentHighlight) => void;
  /** Opens the earlier edition a highlight came from. */
  readonly onOpenEarlier?: ((documentId: string) => void) | undefined;
}): JSX.Element {
  const store = createDocumentHighlightStore({ documentId: () => props.documentId });
  const [docNote, setDocNote] = createSignal('');
  const [docNoteLoaded, setDocNoteLoaded] = createSignal(false);
  const [docNoteSavedAt, setDocNoteSavedAt] = createSignal<string | null>(null);
  const [editingHighlightId, setEditingHighlightId] = createSignal<string | null>(null);
  const [highlightNoteDraft, setHighlightNoteDraft] = createSignal('');

  let autosaveTimer: number | undefined;

  const flushDocNote = async (documentId: string, text: string): Promise<void> => {
    window.clearTimeout(autosaveTimer);
    autosaveTimer = undefined;
    const saved = await saveDocumentNote(documentId, text);
    if (documentId === props.documentId) {
      setDocNoteSavedAt(saved ? saved.updatedAt : null);
    }
  };

  createEffect(() => {
    const documentId = props.documentId;
    if (!props.open || !documentId) return;
    let cancelled = false;
    setDocNoteLoaded(false);
    const refresh = (): void => {
      void loadDocumentNote(documentId).then((record) => {
        if (cancelled) return;
        setDocNote(record?.text ?? '');
        setDocNoteSavedAt(record?.updatedAt ?? null);
        setDocNoteLoaded(true);
      });
    };
    refresh();
    const onExternalChange = (event: Event): void => {
      const detail = (event as CustomEvent<{ readonly documentId?: string }>).detail;
      if (detail?.documentId === documentId && autosaveTimer === undefined) refresh();
    };
    window.addEventListener(DOCUMENT_NOTES_EVENT, onExternalChange);
    onCleanup(() => {
      cancelled = true;
      window.removeEventListener(DOCUMENT_NOTES_EVENT, onExternalChange);
      if (autosaveTimer !== undefined) {
        window.clearTimeout(autosaveTimer);
        autosaveTimer = undefined;
        void saveDocumentNote(documentId, docNote());
      }
    });
  });

  const handleDocNoteInput = (value: string): void => {
    const documentId = props.documentId;
    setDocNote(value);
    window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
      autosaveTimer = undefined;
      void flushDocNote(documentId, value);
    }, NOTE_AUTOSAVE_DELAY_MS);
  };

  const items = (): readonly UserDocumentHighlight[] =>
    store.highlights().filter((item) => !item.cfiRange);
  const missing = (): readonly UserDocumentHighlight[] =>
    items().filter((item) => item.anchorStatus === 'missing');
  const found = (): readonly UserDocumentHighlight[] =>
    items().filter((item) => item.anchorStatus !== 'missing');

  const row = (item: UserDocumentHighlight): JSX.Element => {
    // The heading above the not-found rows already says it.
    const statusNote = item.anchorStatus === 'missing' ? undefined : highlightStatusNote(item);
    const earlier = item.carriedFrom?.documentId;
    const isEditing = () => editingHighlightId() === item.id;
    return (
      <li class="document-highlights__item">
        <div class="document-highlights__row">
          <button
            type="button"
            class="document-highlights__jump"
            disabled={item.anchorStatus === 'missing'}
            onClick={() => {
              props.onClose();
              props.onJump(item);
            }}
          >
            <span
              class="document-highlights__swatch"
              style={{ '--highlight-color': userHighlightColor(item.color).fill }}
              aria-hidden="true"
            />
            <span class="document-highlights__text">
              <span class="document-highlights__quote">{previewQuote(item.quote)}</span>
              <Show when={item.note && !isEditing()}>
                {(personal) => <span class="document-highlights__personal-note">{personal()}</span>}
              </Show>
              <Show when={statusNote}>
                {(value) => <span class="document-highlights__note">{value()}</span>}
              </Show>
            </span>
          </button>
          <button
            type="button"
            class="document-highlights__action"
            aria-label={item.note ? 'Изменить заметку к выделению' : 'Добавить заметку к выделению'}
            title={item.note ? 'Изменить заметку' : 'Добавить заметку'}
            onClick={() => {
              if (isEditing()) {
                setEditingHighlightId(null);
              } else {
                setHighlightNoteDraft(item.note ?? '');
                setEditingHighlightId(item.id);
              }
            }}
          >
            <AppGlyph name="note-pencil" class="document-highlights__icon" />
          </button>
          <Show when={earlier && props.onOpenEarlier}>
            <button
              type="button"
              class="document-highlights__action"
              aria-label="Открыть прежнюю редакцию"
              title="Открыть прежнюю редакцию"
              onClick={() => {
                props.onClose();
                if (earlier) props.onOpenEarlier?.(earlier);
              }}
            >
              <AppGlyph name="arrow-square-out" class="document-highlights__icon" />
            </button>
          </Show>
          <button
            type="button"
            class="document-highlights__action"
            aria-label="Убрать выделение"
            title="Убрать выделение"
            onClick={() => void removeUserHighlight(item.id)}
          >
            <AppGlyph name="trash" class="document-highlights__icon" />
          </button>
        </div>
        <Show when={isEditing()}>
          <div class="document-highlights__editor">
            <textarea
              class="document-highlights__textarea"
              rows={2}
              placeholder="Комментарий к выделенному фрагменту"
              value={highlightNoteDraft()}
              onInput={(event) => setHighlightNoteDraft(event.currentTarget.value)}
            />
            <div class="document-highlights__editor-actions">
              <button
                type="button"
                class="document-highlights__editor-btn"
                onClick={() => setEditingHighlightId(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                class="document-highlights__editor-btn document-highlights__editor-btn--primary"
                onClick={() => {
                  const text = highlightNoteDraft();
                  setEditingHighlightId(null);
                  void updateUserHighlightNote(item.id, text);
                }}
              >
                Сохранить
              </button>
            </div>
          </div>
        </Show>
      </li>
    );
  };

  return (
    <OverlayDialog open={props.open} title="Заметки и выделения" onClose={props.onClose}>
      <div class="document-highlights">
        <section class="document-highlights__doc-note" aria-label="Заметка по документу">
          <div class="document-highlights__doc-note-header">
            <h3 class="document-highlights__heading">Заметка по документу</h3>
            <Show when={docNoteSavedAt()}>
              <span class="document-highlights__saved-badge">Сохранено</span>
            </Show>
          </div>
          <textarea
            class="document-highlights__textarea"
            rows={3}
            disabled={!docNoteLoaded()}
            placeholder="Запишите ключевые выводы, дозировки или нюансы по этому документу"
            value={docNote()}
            onInput={(event) => handleDocNoteInput(event.currentTarget.value)}
            onBlur={() => void flushDocNote(props.documentId, docNote())}
          />
        </section>

        <Show
          when={items().length > 0}
          fallback={
            <p class="document-highlights__empty">
              <AppGlyph name="highlighter" class="document-highlights__icon" />
              Выделите текст в документе, чтобы сохранить цитату и комментарий
            </p>
          }
        >
          <Show when={missing().length > 0}>
            <h3 class="document-highlights__heading">Не найдено в новой редакции</h3>
            <ul class="document-highlights__list">
              <For each={missing()}>{row}</For>
            </ul>
          </Show>
          <Show when={found().length > 0}>
            <h3 class="document-highlights__heading">
              {missing().length > 0 ? 'На странице' : 'Выделения'}
            </h3>
            <ul class="document-highlights__list">
              <For each={found()}>{row}</For>
            </ul>
          </Show>
        </Show>
      </div>
    </OverlayDialog>
  );
}
