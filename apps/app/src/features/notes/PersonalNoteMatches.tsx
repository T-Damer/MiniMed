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
import { AppGlyph } from '@/components/AppGlyph';
import { openUserLibraryDocument } from '@/features/library/user-library-routing';
import type { SearchScope } from '@/features/search/ScopedMedicalCore';
import { PATIENT_NOTES_EVENT, searchPatientNotes } from '@/state/patient-notes';
import {
  listUserLibraryDocuments,
  searchUserLibrary,
  USER_LIBRARY_EVENT,
  type UserLibraryMatch,
} from '@/state/user-library';

interface PersonalNoteMatchesProps {
  readonly query: string;
  readonly scope: SearchScope;
}

/**
 * Personal hits for the active query: patient notes and uploaded books.
 *
 * Rendered outside the official results container on purpose: personal data must never pass as an
 * installed source, in the DOM or on screen.
 */
export function PersonalNoteMatches(props: PersonalNoteMatchesProps): JSX.Element {
  const [revision, setRevision] = createSignal(0);
  const [collapsed, setCollapsed] = createSignal(false);
  const [hasUserLibrary, setHasUserLibrary] = createSignal(false);
  const [libraryMatches, setLibraryMatches] = createSignal<readonly UserLibraryMatch[]>([]);

  const refreshLibraryPresence = (): void => {
    void listUserLibraryDocuments()
      .then((documents) => setHasUserLibrary(documents.length > 0))
      .catch((cause) => {
        setHasUserLibrary(false);
        console.error('Не удалось прочитать личную библиотеку.', cause);
      });
  };

  const bump = (): void => {
    setRevision((current) => current + 1);
    refreshLibraryPresence();
  };

  onMount(() => {
    window.addEventListener(PATIENT_NOTES_EVENT, bump);
    window.addEventListener(USER_LIBRARY_EVENT, bump);
    refreshLibraryPresence();
  });
  onCleanup(() => {
    window.removeEventListener(PATIENT_NOTES_EVENT, bump);
    window.removeEventListener(USER_LIBRARY_EVENT, bump);
  });

  const trimmedQuery = createMemo(() => props.query.trim());

  createEffect(() => {
    revision();
    const query = trimmedQuery();
    if (query.length <= 1) {
      setLibraryMatches([]);
      return;
    }
    void searchUserLibrary(query)
      .then(setLibraryMatches)
      .catch((cause) => {
        setLibraryMatches([]);
        console.error('Не удалось искать в личных книгах.', cause);
      });
  });

  const noteMatches = createMemo(() => {
    revision();
    const query = trimmedQuery();
    return query.length > 1 ? searchPatientNotes(query) : [];
  });

  const showSection = createMemo(() => {
    if (props.scope === 'personal') return trimmedQuery().length > 1;
    return noteMatches().length > 0 || libraryMatches().length > 0;
  });

  const sectionLabel = createMemo(() =>
    hasUserLibrary() || libraryMatches().length > 0 ? 'Ваши данные' : 'Личные записи',
  );

  const ariaLabel = createMemo(() =>
    hasUserLibrary() || libraryMatches().length > 0
      ? 'Совпадения в личных данных'
      : 'Совпадения в личных заметках',
  );

  const toggleLabel = createMemo(() =>
    collapsed() ? `Развернуть раздел «${sectionLabel()}»` : `Свернуть раздел «${sectionLabel()}»`,
  );

  return (
    <Show when={showSection()}>
      <section class="personal-note-matches" aria-label={ariaLabel()}>
        <button
          type="button"
          class="personal-note-matches__toggle"
          aria-expanded={!collapsed()}
          aria-controls="personal-note-matches-panel"
          aria-label={toggleLabel()}
          onClick={() => setCollapsed((value) => !value)}
        >
          <span class="personal-note-badge">{sectionLabel()}</span>
          <small class="personal-note-matches__disclaimer">
            Не официальный источник. Только на этом устройстве.
          </small>
          <AppGlyph
            name="caret-down"
            class={
              collapsed()
                ? 'personal-note-matches__chevron personal-note-matches__chevron--collapsed'
                : 'personal-note-matches__chevron'
            }
          />
        </button>

        <div
          id="personal-note-matches-panel"
          class="personal-note-matches__panel"
          hidden={collapsed()}
        >
          <Show
            when={
              noteMatches().length > 0 || libraryMatches().length > 0 || props.scope !== 'personal'
            }
          >
            <ul class="personal-note-matches__list">
              <For each={noteMatches()}>
                {(match) => (
                  <li class="personal-note-matches__item">
                    <article class="personal-note-matches__card">
                      <AppGlyph name="notes" class="personal-note-matches__icon" />
                      <div class="personal-note-matches__body">
                        <span class="personal-note-badge personal-note-badge--inline">
                          Личные записи
                        </span>
                        <strong class="personal-note-matches__title">{match.card.title}</strong>
                        <p class="personal-note-matches__snippet">{match.snippet}</p>
                        <Show when={match.note === null}>
                          <small class="personal-note-matches__meta">
                            Совпадение в описании карточки
                          </small>
                        </Show>
                      </div>
                    </article>
                  </li>
                )}
              </For>
              <For each={libraryMatches()}>
                {(match) => (
                  <li class="personal-note-matches__item">
                    <button
                      type="button"
                      class="personal-note-matches__card personal-note-matches__card--hit"
                      onClick={() =>
                        openUserLibraryDocument({
                          documentId: match.document.id,
                          pageIndex: match.pageIndex,
                        })
                      }
                    >
                      <AppGlyph name="notepad" class="personal-note-matches__icon" />
                      <div class="personal-note-matches__body">
                        <span class="personal-note-badge personal-note-badge--inline">
                          Личная книга
                        </span>
                        <strong class="personal-note-matches__title">{match.document.title}</strong>
                        <p class="personal-note-matches__snippet">{match.snippet}</p>
                        <Show when={match.document.pageCount > 1}>
                          <small class="personal-note-matches__meta">
                            Страница {match.pageIndex + 1}
                          </small>
                        </Show>
                      </div>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <Show
            when={
              props.scope === 'personal' &&
              trimmedQuery().length > 1 &&
              noteMatches().length === 0 &&
              libraryMatches().length === 0
            }
          >
            <p class="personal-note-matches__empty">В личных данных ничего не найдено.</p>
          </Show>

          <Show when={props.scope !== 'personal' && noteMatches().length > 0}>
            <button
              type="button"
              class="personal-note-matches__open-notes"
              onClick={() => {
                window.location.hash = '#/notes';
              }}
            >
              Открыть заметки
            </button>
          </Show>
        </div>
      </section>
    </Show>
  );
}
