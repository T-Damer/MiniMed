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
import { notesPatientsPath } from '@/features/notes/notes-routing';
import type { SearchScope } from '@/features/search/ScopedMedicalCore';
import type { PatientProfile } from '@/state/patient-domain';
import {
  PATIENT_NOTES_EVENT,
  type PatientNoteMatch,
  searchPatientNotes,
} from '@/state/patient-notes';
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

type PersonalHit =
  | { readonly kind: 'patient'; readonly match: PatientProfileMatch }
  | { readonly kind: 'note'; readonly match: PatientNoteMatch }
  | { readonly kind: 'library'; readonly match: UserLibraryMatch };

interface PatientProfileMatch {
  readonly profile: PatientProfile;
  readonly score: number;
  readonly snippet: string;
}

function patientProfileSearchText(profile: PatientProfile): string {
  return [
    profile.displayName,
    profile.localRecordNumber,
    profile.birthDate,
    profile.biologicalSex,
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
      profile.biologicalSex ?? '',
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
): readonly PatientProfileMatch[] {
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
  pdf: { icon: 'file-pdf', label: 'Личный PDF' },
  dicom: { icon: 'disc', label: 'Медицинское изображение' },
  volume: { icon: 'cube', label: 'Медицинский том' },
  image: { icon: 'image', label: 'Изображение' },
  video: { icon: 'film-slate', label: 'Видео' },
  audio: { icon: 'music-notes', label: 'Аудио' },
  archive: { icon: 'file-zip', label: 'Архив' },
  code: { icon: 'code', label: 'Код' },
  presentation: { icon: 'file-ppt', label: 'Презентация' },
  sheet: { icon: 'file-xls', label: 'Таблица' },
  doc: { icon: 'file-doc', label: 'Документ' },
  ebook: { icon: 'book-open', label: 'Личная книга' },
  text: { icon: 'file-txt', label: 'Текстовый файл' },
  binary: { icon: 'binary', label: 'Файл' },
} satisfies Record<UserLibraryFileKind, { readonly icon: AppGlyphName; readonly label: string }>;

function personalLibraryPresentation(document: UserLibraryMatch['document']): {
  readonly icon: AppGlyphName;
  readonly label: string;
} {
  if (document.source?.kind === 'note') return { icon: 'notes', label: 'Личные записи' };
  return PERSONAL_FILE_PRESENTATION[userLibraryFileKind(document.mimeType, document.fileName)];
}

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
  const [collapsed, setCollapsed] = createSignal(props.scope !== 'personal');
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

  const combinedMatches = createMemo((): readonly PersonalHit[] => {
    const hits: PersonalHit[] = [
      ...patientMatches().map((match) => ({ kind: 'patient' as const, match })),
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
                    {hit.kind === 'patient' ? (
                      <button
                        type="button"
                        class="personal-note-matches__card personal-note-matches__card--hit"
                        onClick={() => {
                          window.location.hash = notesPatientsPath(hit.match.profile.id);
                        }}
                      >
                        <AppGlyph name="users" class="personal-note-matches__icon" />
                        <div class="personal-note-matches__body">
                          <span class="personal-note-badge personal-note-badge--inline">
                            Карточка пациента
                          </span>
                          <strong class="personal-note-matches__title">
                            {hit.match.profile.displayName}
                          </strong>
                          <p class="personal-note-matches__snippet">{hit.match.snippet}</p>
                          <small class="personal-note-matches__meta">
                            Открыть локальную карточку
                          </small>
                        </div>
                      </button>
                    ) : hit.kind === 'note' ? (
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
                        <AppGlyph
                          name={personalLibraryPresentation(hit.match.document).icon}
                          class="personal-note-matches__icon"
                        />
                        <div class="personal-note-matches__body">
                          <span class="personal-note-badge personal-note-badge--inline">
                            {personalLibraryPresentation(hit.match.document).label}
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
