import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';
import { AppBreadcrumbs } from '@/components/AppBreadcrumbs';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { LayoutVirtualizedGrid } from '@/components/LayoutVirtualizedGrid';
import { NavBack } from '@/components/NavBack';
import { SearchField } from '@/components/SearchField';
import { useStickySurface } from '@/components/sticky-surface';
import { openUserLibraryDocument } from '@/features/library/user-library-routing';
import { matchesFuzzyQuery } from '@/state/fuzzy-text';
import {
  addUserLibraryFile,
  listUserLibraryDocuments,
  renameUserLibraryDocument,
  USER_LIBRARY_EVENT,
  type UserLibraryDocument,
  userLibraryFileAccept,
  userLibraryProgressFraction,
} from '@/state/user-library';

function statusLabel(document: UserLibraryDocument): string {
  if (document.status === 'inspecting') return 'Читаем файл…';
  if (document.status === 'ready') return 'Текст в поиске';
  if (document.status === 'failed') {
    return document.errorMessage ?? 'Не удалось обработать файл';
  }
  const done = document.nativeTextPages + document.ocrDonePages;
  return `Распознавание текста · ${done} / ${document.pageCount}`;
}

function UserLibraryPicker(props: {
  readonly dragging: () => boolean;
  readonly setDragging: (value: boolean) => void;
  readonly onFile: (files: FileList | null | undefined) => void;
}): JSX.Element {
  return (
    <label
      class="user-library-picker"
      classList={{ 'user-library-picker--dragging': props.dragging() }}
      onDragEnter={(event) => {
        event.preventDefault();
        props.setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => props.setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        props.setDragging(false);
        props.onFile(event.dataTransfer?.files);
      }}
    >
      <span class="visually-hidden">Загрузить документ</span>
      <input
        type="file"
        class="user-library-picker__input"
        accept={userLibraryFileAccept()}
        onChange={(event) => {
          props.onFile(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      />
      <span class="user-library-picker__plus" aria-hidden="true">
        +
      </span>
      <span class="user-library-picker__label">Загрузить документ</span>
    </label>
  );
}

export function UserLibraryPage(): JSX.Element {
  const [documents, setDocuments] = createSignal<readonly UserLibraryDocument[]>([]);
  const [dragging, setDragging] = createSignal(false);
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [renameValue, setRenameValue] = createSignal('');
  const [searchQuery, setSearchQuery] = createSignal('');
  const [headingElement, setHeadingElement] = createSignal<HTMLElement | undefined>();

  useStickySurface(headingElement);

  const refresh = (): void => {
    void listUserLibraryDocuments()
      .then(setDocuments)
      .catch((cause) => {
        toast.error(
          cause instanceof Error ? cause.message : 'Не удалось прочитать личную библиотеку.',
        );
      });
  };

  onMount(() => {
    refresh();
    window.addEventListener(USER_LIBRARY_EVENT, refresh);
  });
  onCleanup(() => window.removeEventListener(USER_LIBRARY_EVENT, refresh));

  const filteredDocuments = (): readonly UserLibraryDocument[] => {
    const query = searchQuery().trim();
    if (!query) return documents();
    return documents().filter((document) =>
      matchesFuzzyQuery(query, [document.title, document.fileName]),
    );
  };

  const appendFile = async (files: FileList | null | undefined): Promise<void> => {
    const file = files?.[0];
    if (!file) return;
    try {
      await addUserLibraryFile(file);
      toast.success('Документ добавлен в личную библиотеку');
      refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось загрузить файл.');
    }
  };

  const startRename = (document: UserLibraryDocument): void => {
    setRenamingId(document.id);
    setRenameValue(document.title);
  };

  const cancelRename = (): void => {
    setRenamingId(null);
  };

  const commitRename = async (documentId: string): Promise<void> => {
    const title = renameValue().trim();
    setRenamingId(null);
    if (!title) return;
    await renameUserLibraryDocument(documentId, title);
    refresh();
  };

  const navigate = (href: string): void => {
    window.location.hash = href;
  };

  return (
    <section class="user-library-page" aria-label="Ваши документы">
      <div
        ref={setHeadingElement}
        class="knowledge-subroute-heading knowledge-subroute-heading--blurred module-catalog-heading route-sticky-chrome"
      >
        <NavBack
          class="knowledge-back-button knowledge-subroute-heading__control"
          aria-label="Назад к каталогу документов"
          onClick={() => navigate('#/modules/documents')}
        />
        <SearchField
          class="route-search knowledge-subroute-heading__control"
          value={searchQuery()}
          onInput={setSearchQuery}
          label="Поиск по вашим документам"
          hideLabel
          placeholder="Название или файл"
        />
      </div>

      <AppBreadcrumbs
        items={[{ label: 'Документы', href: '#/modules/documents' }, { label: 'Ваши документы' }]}
        onNavigate={navigate}
      />
      <h1 class="user-library-page__title">Ваши документы</h1>
      <p class="user-library-page__kicker">Только на этом устройстве. Не официальный источник.</p>

      <UserLibraryPicker
        dragging={dragging}
        setDragging={setDragging}
        onFile={(files) => void appendFile(files)}
      />

      <Show
        when={filteredDocuments().length > 0}
        fallback={
          <p class="user-library-page__empty">
            {searchQuery().trim()
              ? 'Ничего не найдено по вашему запросу.'
              : 'Загрузите PDF, текст или изображение — документ останется только на этом устройстве.'}
          </p>
        }
      >
        <div class="user-library-page__list">
          <LayoutVirtualizedGrid data={filteredDocuments()} bufferSize={500}>
            {(libraryDocument) => {
              const progress = (): number => userLibraryProgressFraction(libraryDocument);
              const renaming = (): boolean => renamingId() === libraryDocument.id;
              return (
                <article class="user-library-card paper-card">
                  <Show
                    when={renaming()}
                    fallback={
                      <div class="user-library-card__row">
                        <button
                          type="button"
                          class="user-library-card__open"
                          onClick={() =>
                            openUserLibraryDocument({
                              documentId: libraryDocument.id,
                              title: libraryDocument.title,
                            })
                          }
                        >
                          <strong class="user-library-card__title">{libraryDocument.title}</strong>
                          <span class="user-library-card__file-name">
                            {libraryDocument.fileName}
                          </span>
                          <span class="user-library-card__progress">
                            {statusLabel(libraryDocument)}
                          </span>
                          <Show
                            when={
                              libraryDocument.status === 'inspecting' ||
                              libraryDocument.status === 'ocr'
                            }
                          >
                            <progress
                              class="user-library-card__progress-bar"
                              max={1}
                              value={progress()}
                            />
                          </Show>
                        </button>
                        <Button
                          type="button"
                          variant="icon"
                          class="user-library-card__icon-action"
                          aria-label="Изменить название"
                          onClick={(event) => {
                            event.stopPropagation();
                            startRename(libraryDocument);
                          }}
                          icon={<AppGlyph name="edit" class="user-library-card__icon" />}
                        />
                      </div>
                    }
                  >
                    <div class="user-library-card__rename-row">
                      <input
                        class="user-library-card__rename"
                        type="text"
                        value={renameValue()}
                        aria-label="Название документа"
                        ref={(element) => {
                          queueMicrotask(() => element.focus());
                        }}
                        onInput={(event) => setRenameValue(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void commitRename(libraryDocument.id);
                          if (event.key === 'Escape') cancelRename();
                        }}
                      />
                      <Button
                        type="button"
                        variant="icon"
                        class="user-library-card__icon-action"
                        aria-label="Подтвердить название"
                        onClick={(event) => {
                          event.stopPropagation();
                          void commitRename(libraryDocument.id);
                        }}
                        icon={<AppGlyph name="check" class="user-library-card__icon" />}
                      />
                    </div>
                  </Show>
                </article>
              );
            }}
          </LayoutVirtualizedGrid>
        </div>
      </Show>
    </section>
  );
}
