import {
  createDeferred,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { openUserLibraryDocument } from '@/features/library/user-library-routing';
import { notesPath, notesPatientsPath } from '@/features/notes/notes-routing';
import { patientSexLabel } from '@/features/notes/patient-labels';
import {
  combineAndDeduplicatePersonalHits,
  type PatientProfileSearchMatch,
  type PersonalHit,
  personalHitMatchedInTitle,
} from '@/features/notes/personal-search-matches';
import type { SearchScope } from '@/features/search/ScopedMedicalCore';
import type { PatientProfile } from '@/state/patient-domain';
import { PATIENT_NOTES_EVENT, searchPatientNotes } from '@/state/patient-notes';
import {
  isPatientVaultUnlocked,
  PATIENT_VAULT_EVENT,
  PATIENT_VAULT_LOCK_EVENT,
  readPatientVault,
} from '@/state/patient-vault';
import { personalMatchScore, personalQueryStems } from '@/state/personal-stem-match';
import {
  listUserLibraryDocuments,
  searchUserLibrary,
  USER_LIBRARY_EVENT,
  type UserLibraryFileKind,
  type UserLibraryMatch,
  userLibraryFileKind,
} from '@/state/user-library';

function patientProfileSearchText(profile: PatientProfile): string {
  return [
    profile.displayName,
    profile.localRecordNumber,
    profile.birthDate,
    patientSexLabel(profile.biologicalSex),
    profile.summary,
    ...Object.values(profile.context ?? {}).map(String),
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ');
}

function patientProfileSnippet(profile: PatientProfile): string {
  return (
    [
      profile.localRecordNumber ? `№ ${profile.localRecordNumber}` : '',
      profile.birthDate ? `рожд. ${profile.birthDate}` : '',
      patientSexLabel(profile.biologicalSex) ?? '',
      profile.summary ?? '',
    ]
      .filter(Boolean)
      .join(' · ') || 'Локальная карточка пациента'
  );
}

function searchPatientProfiles(
  profiles: readonly PatientProfile[],
  query: string,
  limit = 5,
): readonly PatientProfileSearchMatch[] {
  const queryStems = personalQueryStems(query);
  return profiles
    .map((profile) => ({
      profile,
      score: personalMatchScore(queryStems, patientProfileSearchText(profile)),
      snippet: patientProfileSnippet(profile),
    }))
    .filter((match) => match.score > 0)
    .toSorted(
      (left, right) =>
        right.score - left.score || right.profile.updatedAt.localeCompare(left.profile.updatedAt),
    )
    .slice(0, limit);
}

const PERSONAL_FILE_PRESENTATION = {
  questionnaire: { icon: 'list-checks', label: 'Опросник' },
  pdf: { icon: 'file-pdf', label: 'PDF' },
  dicom: { icon: 'disc', label: 'Изображение' },
  volume: { icon: 'cube', label: 'Том' },
  image: { icon: 'image', label: 'Изображение' },
  video: { icon: 'film-slate', label: 'Видео' },
  audio: { icon: 'music-notes', label: 'Аудио' },
  archive: { icon: 'file-zip', label: 'Архив' },
  code: { icon: 'code', label: 'Код' },
  presentation: { icon: 'file-ppt', label: 'Презентация' },
  sheet: { icon: 'file-xls', label: 'Таблица' },
  doc: { icon: 'file-doc', label: 'Документ' },
  ebook: { icon: 'book-open', label: 'Книга' },
  text: { icon: 'file-txt', label: 'Текст' },
  binary: { icon: 'binary', label: 'Файл' },
} satisfies Record<UserLibraryFileKind, { readonly icon: AppGlyphName; readonly label: string }>;

function personalLibraryPresentation(document: UserLibraryMatch['document']): {
  readonly icon: AppGlyphName;
  readonly label: string;
} {
  if (document.source?.kind === 'note') return { icon: 'notes', label: 'Заметка' };
  return PERSONAL_FILE_PRESENTATION[userLibraryFileKind(document.mimeType, document.fileName)];
}

function describePersonalHit(hit: PersonalHit): {
  readonly id: string;
  readonly icon: AppGlyphName;
  readonly kindLabel: string;
  readonly title: string;
  readonly snippet: string;
  readonly pageLabel?: string;
  readonly onOpen: () => void;
} {
  if (hit.kind === 'patient') {
    return {
      id: `patient:${hit.match.profile.id}`,
      icon: 'users',
      kindLabel: 'Пациент',
      title: hit.match.profile.displayName,
      snippet: hit.match.snippet,
      onOpen: () => {
        window.location.hash = notesPatientsPath(hit.match.profile.id);
      },
    };
  }
  if (hit.kind === 'note') {
    const noteTitle = hit.match.note?.title.trim();
    const title = noteTitle ? `${hit.match.card.title} — ${noteTitle}` : hit.match.card.title;
    return {
      id: `note:${hit.match.card.id}:${hit.match.note?.id ?? 'card'}`,
      icon: 'notes',
      kindLabel: 'Заметка',
      title,
      snippet: hit.match.snippet,
      onOpen: () => {
        window.location.hash = notesPath(hit.match.card.id);
      },
    };
  }
  const presentation = personalLibraryPresentation(hit.match.document);
  return {
    id: `library:${hit.match.document.id}:${hit.match.pageIndex}`,
    icon: presentation.icon,
    kindLabel: presentation.label,
    title: hit.match.document.title,
    snippet: hit.match.snippet,
    ...(hit.match.document.pageCount > 1 ? { pageLabel: `Стр. ${hit.match.pageIndex + 1}` } : {}),
    onOpen: () =>
      openUserLibraryDocument({
        documentId: hit.match.document.id,
        pageIndex: hit.match.pageIndex,
      }),
  };
}

interface PersonalNoteMatchesProps {
  readonly query: string;
  readonly scope: SearchScope;
}

/**
 * Personal hits for the active query: patient cards, notes, and uploaded files.
 * Rendered cleanly outside the official results container; deduplicates notes mirrored in
 * user-library and shows an accordion only when the match is in the body text rather than the name.
 */
export function PersonalNoteMatches(props: PersonalNoteMatchesProps): JSX.Element {
  const [revision, setRevision] = createSignal(0);
  const [collapsed, setCollapsed] = createSignal(props.scope !== 'personal');
  const [expandedHitIds, setExpandedHitIds] = createSignal<ReadonlySet<string>>(new Set());
  const [hasUserLibrary, setHasUserLibrary] = createSignal(false);
  const [libraryMatches, setLibraryMatches] = createSignal<readonly UserLibraryMatch[]>([]);
  const [patientProfiles, setPatientProfiles] = createSignal<readonly PatientProfile[]>([]);
  let patientReadRequest = 0;

  const refreshLibraryPresence = (): void => {
    void listUserLibraryDocuments()
      .then((documents) => setHasUserLibrary(documents.length > 0))
      .catch((cause) => {
        setHasUserLibrary(false);
        console.error('Не удалось прочитать личную библиотеку.', cause);
      });
  };

  const refreshPatientProfiles = (): void => {
    const request = ++patientReadRequest;
    if (!isPatientVaultUnlocked()) {
      setPatientProfiles([]);
      return;
    }
    void readPatientVault()
      .then((snapshot) => {
        if (request === patientReadRequest && isPatientVaultUnlocked()) {
          setPatientProfiles(snapshot.profiles);
        }
      })
      .catch((cause) => {
        if (request !== patientReadRequest) return;
        setPatientProfiles([]);
        console.error('Не удалось прочитать карточки пациентов для поиска.', cause);
      });
  };

  const bump = (): void => {
    setRevision((current) => current + 1);
    refreshLibraryPresence();
    refreshPatientProfiles();
  };

  onMount(() => {
    window.addEventListener(PATIENT_NOTES_EVENT, bump);
    window.addEventListener(PATIENT_VAULT_EVENT, bump);
    window.addEventListener(PATIENT_VAULT_LOCK_EVENT, bump);
    window.addEventListener(USER_LIBRARY_EVENT, bump);
    refreshLibraryPresence();
    refreshPatientProfiles();
  });
  onCleanup(() => {
    window.removeEventListener(PATIENT_NOTES_EVENT, bump);
    window.removeEventListener(PATIENT_VAULT_EVENT, bump);
    window.removeEventListener(PATIENT_VAULT_LOCK_EVENT, bump);
    window.removeEventListener(USER_LIBRARY_EVENT, bump);
    patientReadRequest += 1;
  });

  const trimmedQuery = createMemo(() => props.query.trim());
  const deferredQuery = createDeferred(trimmedQuery, { timeoutMs: 120 });

  createEffect(() => {
    trimmedQuery();
    setCollapsed(props.scope !== 'personal');
    setExpandedHitIds(new Set<string>());
  });

  createEffect(() => {
    revision();
    const query = deferredQuery();
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
    const query = deferredQuery();
    return query.length > 1 ? searchPatientNotes(query, 5) : [];
  });

  const patientMatches = createMemo(() => {
    const query = deferredQuery();
    return query.length > 1 ? searchPatientProfiles(patientProfiles(), query, 5) : [];
  });

  const combinedMatches = createMemo((): readonly PersonalHit[] =>
    combineAndDeduplicatePersonalHits(patientMatches(), noteMatches(), libraryMatches(), 5),
  );

  const showSection = createMemo(() => {
    if (props.scope === 'personal') return trimmedQuery().length > 1;
    return combinedMatches().length > 0;
  });

  const sectionLabel = createMemo(() =>
    props.scope === 'personal' ||
    hasUserLibrary() ||
    libraryMatches().length > 0 ||
    patientMatches().length > 0
      ? 'Ваши данные'
      : 'Личные записи',
  );

  const ariaLabel = createMemo(() =>
    sectionLabel() === 'Ваши данные'
      ? 'Совпадения в личных данных'
      : 'Совпадения в личных заметках',
  );

  const toggleLabel = createMemo(() =>
    collapsed() ? `Развернуть раздел «${sectionLabel()}»` : `Свернуть раздел «${sectionLabel()}»`,
  );

  const hasAnyNoteMatch = createMemo(
    () =>
      noteMatches().length > 0 ||
      libraryMatches().some((match) => match.document.source?.kind === 'note'),
  );

  const toggleSnippet = (id: string): void => {
    setExpandedHitIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
          <span class="personal-note-matches__heading">{sectionLabel()}</span>
          <Show when={combinedMatches().length > 0}>
            <span class="personal-note-matches__count">{combinedMatches().length}</span>
          </Show>
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
                {(hit) => {
                  const item = describePersonalHit(hit);
                  const showAccordion = () =>
                    Boolean(item.snippet.trim()) &&
                    !personalHitMatchedInTitle(trimmedQuery(), item.title);
                  const expanded = () => expandedHitIds().has(item.id);
                  return (
                    <li class="personal-note-matches__item">
                      <div class="personal-note-matches__row">
                        <button
                          type="button"
                          class="personal-note-matches__card personal-note-matches__card--hit"
                          onClick={item.onOpen}
                        >
                          <AppGlyph name={item.icon} class="personal-note-matches__icon" />
                          <span class="personal-note-matches__line">
                            <span class="personal-note-matches__kind">{item.kindLabel}</span>
                            <span class="personal-note-matches__sep" aria-hidden="true">
                              —
                            </span>
                            <strong class="personal-note-matches__title">{item.title}</strong>
                            <Show when={item.pageLabel}>
                              {(page) => (
                                <span class="personal-note-matches__page">· {page()}</span>
                              )}
                            </Show>
                          </span>
                        </button>
                        <Show when={showAccordion()}>
                          <button
                            type="button"
                            class="personal-note-matches__disclosure"
                            aria-expanded={expanded()}
                            aria-label={
                              expanded()
                                ? `Скрыть фрагмент: ${item.title}`
                                : `Показать найденный фрагмент: ${item.title}`
                            }
                            onClick={() => toggleSnippet(item.id)}
                          >
                            <AppGlyph
                              name="caret-down"
                              class={
                                expanded()
                                  ? 'personal-note-matches__disclosure-icon personal-note-matches__disclosure-icon--open'
                                  : 'personal-note-matches__disclosure-icon'
                              }
                            />
                          </button>
                        </Show>
                      </div>
                      <Show when={showAccordion() && expanded()}>
                        <p class="personal-note-matches__snippet">{item.snippet}</p>
                      </Show>
                    </li>
                  );
                }}
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

          <Show when={props.scope !== 'personal' && hasAnyNoteMatch()}>
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
