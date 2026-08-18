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
import {
  PATIENT_NOTES_EVENT,
  type PatientNoteMatch,
  searchPatientNotes,
} from '@/state/patient-notes';
import {
  listUserLibraryDocuments,
  searchUserLibrary,
  USER_LIBRARY_EVENT,
  type UserLibraryMatch,
} from '@/state/user-library';

type PersonalHit =
  | { readonly kind: 'note'; readonly match: PatientNoteMatch }
  | { readonly kind: 'library'; readonly match: UserLibraryMatch };

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
  const [collapsed, setCollapsed] = createSignal(true);
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
    trimmedQuery();
    setCollapsed(true);
  });

  createEffect(() => {
    revision();
    const query = trimmedQuery();
    if (query.length <= 1) {
      setLibraryMatches([]);
      return;
    }
    void searchUserLibrary(query, 5)
      .then(setLibraryMatches)
      .catch((cause) => {
        setLibraryMatches([]);
        console.error('Не удалось искать в личных книгах.', cause);
      });
  });

  const noteMatches = createMemo(() => {
    revision();
    const query = trimmedQuery();
    return query.length > 1 ? searchPatientNotes(query, 5) : [];
  });

  const combinedMatches = createMemo((): readonly PersonalHit[] => {
    const hits: PersonalHit[] = [
      ...noteMatches().map((match) => ({ kind: 'note' as const, match })),
      ...libraryMatches().map((match) => ({ kind: 'library' as const, match })),
    ];
    return hits.toSorted((left, right) => right.match.score - left.match.score).slice(0, 5);
  });

  const showSection = createMemo(() => {
    if (props.scope === 'personal') return trimmedQuery().length > 1;
    return combinedMatches().length > 0;
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
          <Show when={combinedMatches().length > 0 || props.scope !== 'personal'}>
            <ul class="personal-note-matches__list">
              <For each={combinedMatches()}>
                {(hit) => (
                  <li class="personal-note-matches__item">
                    {hit.kind === 'note' ? (
                      <article class="personal-note-matches__card">
                        <AppGlyph name="notes" class="personal-note-matches__icon" />
                        <div class="personal-note-matches__body">
                          <span class="personal-note-badge personal-note-badge--inline">
                            Личные записи
                          </span>
                          <strong class="personal-note-matches__title">
                            {hit.match.card.title}
                          </strong>
                          <p class="personal-note-matches__snippet">{hit.match.snippet}</p>
                          <Show when={hit.match.note === null}>
                            <small class="personal-note-matches__meta">
                              Совпадение в описании карточки
                            </small>
                          </Show>
                        </div>
                      </article>
                    ) : (
                      <button
                        type="button"
                        class="personal-note-matches__card personal-note-matches__card--hit"
                        onClick={() =>
                          openUserLibraryDocument({
                            documentId: hit.match.document.id,
                            pageIndex: hit.match.pageIndex,
                          })
                        }
                      >
                        <AppGlyph name="notepad" class="personal-note-matches__icon" />
                        <div class="personal-note-matches__body">
                          <span class="personal-note-badge personal-note-badge--inline">
                            Личная книга
                          </span>
                          <strong class="personal-note-matches__title">
                            {hit.match.document.title}
                          </strong>
                          <p class="personal-note-matches__snippet">{hit.match.snippet}</p>
                          <Show when={hit.match.document.pageCount > 1}>
                            <small class="personal-note-matches__meta">
                              Страница {hit.match.pageIndex + 1}
                            </small>
                          </Show>
                        </div>
                      </button>
                    )}
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <Show
            when={
              props.scope === 'personal' &&
              trimmedQuery().length > 1 &&
              combinedMatches().length === 0
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
