import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
} from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { createDebouncer } from '@/components/debounced-value';
import { OverlayDialog } from '@/components/OverlayDialog';
import { PatientPickerRow } from '@/components/PatientPickerRow';
import { TextArea } from '@/components/TextArea';
import { usePatientVaultSnapshot } from '@/features/forms/use-patient-vault-snapshot';
import { createObjectUrlCache } from '@/features/skin/object-url-cache';
import { SkinResultCards, SkinStatusLines } from '@/features/skin/SkinResults';
import { skinDetailsLabels } from '@/features/skin/skin-details';
import type { SkinDocumentLink } from '@/features/skin/skin-document-links';
import {
  SKIN_HISTORY_EVENT,
  type SkinHistoryEntry,
  type SkinHistoryStore,
} from '@/features/skin/skin-history';
import { skinResultViews, skinStatusLines } from '@/features/skin/skin-results';
import { FEEDBACK_MOMENTS, playFeedback } from '@/state/ui-feedback';

import '@/styles/skin-photo.css';

const NOTE_SAVE_DELAY_MS = 500;
const SKELETON_CELLS = [0, 1, 2, 3, 4, 5] as const;

function entryTitle(createdAt: number): string {
  return new Date(createdAt).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** One saved analysis: its photo, ranking, details, a note that saves as it is typed, a patient. */
function SkinHistoryItem(props: {
  readonly entry: SkinHistoryEntry;
  readonly store: SkinHistoryStore;
  readonly photoUrl: string;
  readonly linksFor: (classId: string) => readonly SkinDocumentLink[];
  readonly onOpenDocument: (documentId: string) => void;
  readonly onDeleted: () => void;
}): JSX.Element {
  const vault = usePatientVaultSnapshot();
  const [note, setNote] = createSignal(props.entry.note);
  const [patientId, setPatientId] = createSignal(props.entry.patientId ?? '');
  const [confirming, setConfirming] = createSignal(false);
  const entryId = props.entry.id;

  const saveNote = createDebouncer((value: string) => {
    void props.store.update(entryId, { note: value });
  }, NOTE_SAVE_DELAY_MS);
  // The last words typed before the sheet closes are not lost.
  onCleanup(() => {
    saveNote.cancel();
    if (note() !== props.entry.note) void props.store.update(entryId, { note: note() });
  });

  const views = createMemo(() => skinResultViews(props.entry.results?.predictions ?? []));
  const labels = createMemo(() => skinDetailsLabels(props.entry.details));

  const remove = async (): Promise<void> => {
    saveNote.cancel();
    await props.store.remove(entryId);
    playFeedback(...FEEDBACK_MOMENTS.saved);
    props.onDeleted();
  };

  return (
    <div class="skin-entry" data-testid="skin-history-item">
      <img class="skin-entry__photo" src={props.photoUrl} alt="Снимок кожи" />
      <Show when={labels().length > 0}>
        <ul class="skin-entry__labels">
          <For each={labels()}>{(label) => <li class="skin-entry__label">{label}</li>}</For>
        </ul>
      </Show>
      <Show
        when={props.entry.results}
        fallback={
          <p class="skin-entry__unranked">
            <AppGlyph name="info" class="skin-entry__unranked-icon" />
            Без анализа
          </p>
        }
      >
        {(results) => (
          <>
            <SkinStatusLines lines={skinStatusLines(results())} />
            <SkinResultCards
              views={views()}
              linksFor={props.linksFor}
              busy={false}
              onOpenDocument={props.onOpenDocument}
            />
          </>
        )}
      </Show>
      <PatientPickerRow
        profiles={vault.snapshot()?.profiles ?? []}
        patientId={patientId()}
        unlocked={vault.unlocked()}
        hint="Прикрепить к пациенту"
        onPatientChange={(next) => {
          setPatientId(next);
          void props.store.update(entryId, { patientId: next === '' ? null : next });
        }}
        onSnapshotChange={vault.adopt}
      />
      <TextArea
        label="Заметка"
        hideLabel
        class="skin-entry__note"
        rows={3}
        placeholder="Заметка к снимку"
        value={note()}
        data-testid="skin-note"
        onInput={(event) => {
          setNote(event.currentTarget.value);
          saveNote.call(event.currentTarget.value);
        }}
      />
      <div class="skin-entry__delete">
        <Show
          when={confirming()}
          fallback={
            <button
              type="button"
              class="skin-entry__button skin-entry__button--danger"
              data-testid="skin-delete"
              onClick={() => setConfirming(true)}
            >
              <AppGlyph name="trash" class="skin-entry__button-icon" />
              Удалить
            </button>
          }
        >
          <span class="skin-entry__confirm" role="alert">
            Удалить снимок?
          </span>
          <button type="button" class="skin-entry__button" onClick={() => setConfirming(false)}>
            Отмена
          </button>
          <button
            type="button"
            class="skin-entry__button skin-entry__button--danger"
            data-testid="skin-delete-confirm"
            onClick={() => void remove()}
          >
            <AppGlyph name="trash" class="skin-entry__button-icon" />
            Удалить
          </button>
        </Show>
      </div>
    </div>
  );
}

/** The gallery: a grid of thumbnails; a tap opens the saved analysis over it. */
export function SkinHistorySheet(props: {
  readonly open: boolean;
  readonly store: SkinHistoryStore;
  readonly linksFor: (classId: string) => readonly SkinDocumentLink[];
  readonly onOpenDocument: (documentId: string) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [version, setVersion] = createSignal(0);
  // A plain signal, not a resource: the page sits inside a Suspense boundary, and a pending
  // resource would swap the whole page for its skeleton and hold the dialogs' effects back.
  const [entries, setEntries] = createSignal<readonly SkinHistoryEntry[]>();
  const [failed, setFailed] = createSignal(false);
  let loadRun = 0;
  createEffect(
    on([() => props.open, version], ([open]) => {
      if (!open) return;
      const run = ++loadRun;
      props.store
        .list()
        .then((list) => {
          if (run !== loadRun) return;
          setFailed(false);
          setEntries(list);
        })
        .catch(() => {
          if (run === loadRun) setFailed(true);
        });
    }),
  );
  const [selectedId, setSelectedId] = createSignal<string>();
  const urls = createObjectUrlCache();
  onMount(() => {
    const refresh = (): void => {
      setVersion((current) => current + 1);
    };
    window.addEventListener(SKIN_HISTORY_EVENT, refresh);
    onCleanup(() => window.removeEventListener(SKIN_HISTORY_EVENT, refresh));
  });
  onCleanup(() => urls.revokeAll());

  // Keep the list on screen while it refreshes: a reload never swaps it for a loader.
  const list = (): readonly SkinHistoryEntry[] => entries() ?? [];
  const ids = createMemo((): readonly string[] => list().map((entry) => entry.id), [], {
    equals: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]),
  });
  const byId = createMemo(() => new Map(list().map((entry) => [entry.id, entry])));
  /** The entry as it was when opened: a refresh of the list must not rebuild the open item. */
  const selected = createMemo((): SkinHistoryEntry | undefined => {
    const id = selectedId();
    return id === undefined ? undefined : untrack(byId).get(id);
  });

  return (
    <>
      <OverlayDialog
        open={props.open}
        title="История снимков"
        class="skin-history"
        bodyClass="skin-history__body"
        onClose={props.onClose}
      >
        <Show
          when={ids().length > 0}
          fallback={
            <Switch>
              <Match when={failed()}>
                <p class="skin-history__empty">
                  <AppGlyph name="info" class="skin-history__empty-icon" />
                  Не удалось открыть историю
                </p>
              </Match>
              <Match when={entries() !== undefined}>
                <p class="skin-history__empty" data-testid="skin-history-empty">
                  <AppGlyph name="image" class="skin-history__empty-icon" />
                  Снимков пока нет
                </p>
              </Match>
              <Match when={true}>
                <ul class="skin-history__grid" aria-hidden="true">
                  <For each={SKELETON_CELLS}>
                    {() => <li class="skin-history__cell skin-history__cell--skeleton" />}
                  </For>
                </ul>
              </Match>
            </Switch>
          }
        >
          <ul class="skin-history__grid" data-testid="skin-history-grid">
            <For each={ids()}>
              {(id) => {
                // A thumbnail never changes once saved: read the entry once.
                const entry = untrack(byId).get(id);
                return entry ? (
                  <li class="skin-history__cell">
                    <button
                      type="button"
                      class="skin-history__thumb"
                      data-testid="skin-history-thumb"
                      aria-label={`Снимок от ${entryTitle(entry.createdAt)}`}
                      onClick={() => setSelectedId(id)}
                    >
                      <img
                        class="skin-history__image"
                        src={urls.get(`t:${id}`, entry.thumbnail)}
                        alt=""
                        loading="lazy"
                      />
                    </button>
                  </li>
                ) : null;
              }}
            </For>
          </ul>
        </Show>
      </OverlayDialog>
      <OverlayDialog
        open={props.open && selected() !== undefined}
        title={selected() ? entryTitle(selected()?.createdAt ?? 0) : 'Снимок'}
        class="skin-history"
        bodyClass="skin-history__body"
        onClose={() => {
          setSelectedId(undefined);
        }}
      >
        <Show when={selected()} keyed>
          {(entry) => (
            <SkinHistoryItem
              entry={entry}
              store={props.store}
              photoUrl={urls.get(`p:${entry.id}`, entry.photo)}
              linksFor={props.linksFor}
              onOpenDocument={props.onOpenDocument}
              onDeleted={() => {
                setSelectedId(undefined);
                urls.revoke(`p:${entry.id}`);
                urls.revoke(`t:${entry.id}`);
              }}
            />
          )}
        </Show>
      </OverlayDialog>
    </>
  );
}
