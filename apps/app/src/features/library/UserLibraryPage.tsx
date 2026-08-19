import {
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { toast } from 'solid-sonner';

import { AppBreadcrumbs } from '@/components/AppBreadcrumbs';
import {
  AppContextMenu,
  type AppContextMenuAction,
} from '@/components/AppContextMenu';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { LayoutVirtualizedGrid } from '@/components/LayoutVirtualizedGrid';
import { NavBack } from '@/components/NavBack';
import { SearchField } from '@/components/SearchField';
import { useStickySurface } from '@/components/sticky-surface';
import { openUserLibraryDocument } from '@/features/library/user-library-routing';
import { matchesFuzzyQuery } from '@/state/fuzzy-text';
import {
  addUserLibraryFile,
  createUserLibraryFolder,
  isUserLibraryVisualMime,
  listUserLibraryDocuments,
  listUserLibraryFolders,
  moveUserLibraryDocument,
  moveUserLibraryFolder,
  removeUserLibraryDocument,
  removeUserLibraryFolder,
  renameUserLibraryDocument,
  renameUserLibraryFolder,
  requestUserLibraryOcr,
  USER_LIBRARY_EVENT,
  type UserLibraryDocument,
  type UserLibraryFolder,
  type UserLibraryOcrQuality,
  userLibraryFileAccept,
  userLibraryProgressFraction,
} from '@/state/user-library';

interface RenameTarget {
  readonly kind: 'document' | 'folder';
  readonly id: string;
  readonly title: string;
}

interface DeleteTarget {
  readonly kind: 'document' | 'folder';
  readonly id: string;
  readonly title: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} МБ`;
}

function activeOcrDocumentId(documents: readonly UserLibraryDocument[]): string | null {
  return (
    documents
      .filter((document) => document.status === 'ocr')
      .toSorted((left, right) => {
        const priority = (right.ocrPriority ?? 0) - (left.ocrPriority ?? 0);
        return priority || left.createdAt.localeCompare(right.createdAt);
      })[0]?.id ?? null
  );
}

function statusLabel(document: UserLibraryDocument, activeOcrId: string | null): string {
  if (document.status === 'inspecting') return 'Читаем файл…';
  if (document.status === 'ready') {
    return `${document.pageCount} стр. · ${formatFileSize(document.byteLength)}`;
  }
  if (document.status === 'failed') {
    return document.errorMessage ?? 'Не удалось обработать файл';
  }
  if (document.id !== activeOcrId) return 'В очереди на распознавание текста';
  const done = document.nativeTextPages + document.ocrDonePages;
  return `Распознавание текста · ${done} / ${document.pageCount}`;
}

function folderDescendants(
  folders: readonly UserLibraryFolder[],
  folderId: string,
): ReadonlySet<string> {
  const result = new Set<string>();
  const queue = [folderId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const folder of folders) {
      if (folder.parentId !== current || result.has(folder.id)) continue;
      result.add(folder.id);
      queue.push(folder.id);
    }
  }
  return result;
}

function UserLibraryPicker(props: {
  readonly dragging: () => boolean;
  readonly setDragging: (value: boolean) => void;
  readonly onFiles: (files: FileList | null | undefined) => void;
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
        props.onFiles(event.dataTransfer?.files);
      }}
    >
      <span class="visually-hidden">Загрузить документы</span>
      <input
        type="file"
        multiple
        class="user-library-picker__input"
        accept={userLibraryFileAccept()}
        onChange={(event) => {
          props.onFiles(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      />
      <span class="user-library-picker__plus" aria-hidden="true">+</span>
      <span class="user-library-picker__label">Загрузить документы</span>
    </label>
  );
}

export function UserLibraryPage(): JSX.Element {
  const [documents, setDocuments] = createSignal<readonly UserLibraryDocument[]>([]);
  const [folders, setFolders] = createSignal<readonly UserLibraryFolder[]>([]);
  const [currentFolderId, setCurrentFolderId] = createSignal<string | null>(null);
  const [dragging, setDragging] = createSignal(false);
  const [renameTarget, setRenameTarget] = createSignal<RenameTarget | null>(null);
  const [renameValue, setRenameValue] = createSignal('');
  const [searchQuery, setSearchQuery] = createSignal('');
  const [headingElement, setHeadingElement] = createSignal<HTMLElement | undefined>();
  const [creatingFolder, setCreatingFolder] = createSignal(false);
  const [folderTitle, setFolderTitle] = createSignal('');
  const [deleteTarget, setDeleteTarget] = createSignal<DeleteTarget | null>(null);

  useStickySurface(headingElement);

  const refresh = (): void => {
    void Promise.all([listUserLibraryDocuments(), listUserLibraryFolders()])
      .then(([nextDocuments, nextFolders]) => {
        setDocuments(nextDocuments);
        setFolders(nextFolders);
        const current = currentFolderId();
        if (current && !nextFolders.some((folder) => folder.id === current)) {
          setCurrentFolderId(null);
        }
      })
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

  const activeOcrId = createMemo(() => activeOcrDocumentId(documents()));
  const currentFolder = createMemo(() =>
    folders().find((folder) => folder.id === currentFolderId()),
  );
  const visibleFolders = createMemo(() =>
    folders().filter((folder) => folder.parentId === currentFolderId()),
  );
  const visibleDocuments = createMemo(() => {
    const query = searchQuery().trim();
    return documents().filter((document) => {
      if ((document.folderId ?? null) !== currentFolderId()) return false;
      return !query || matchesFuzzyQuery(query, [document.title, document.fileName]);
    });
  });
  const folderTrail = createMemo(() => {
    const byId = new Map(folders().map((folder) => [folder.id, folder]));
    const trail: UserLibraryFolder[] = [];
    let cursor = currentFolder();
    while (cursor) {
      trail.unshift(cursor);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return trail;
  });

  const appendFiles = async (files: FileList | null | undefined): Promise<void> => {
    for (const file of Array.from(files ?? [])) {
      try {
        await addUserLibraryFile(file, currentFolderId());
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : 'Не удалось загрузить файл.');
      }
    }
    if (files?.length) toast.success('Документы добавлены в личную библиотеку');
    refresh();
  };

  const startRename = (target: RenameTarget): void => {
    setRenameTarget(target);
    setRenameValue(target.title);
  };

  const cancelRename = (): void => {
    setRenameTarget(null);
    setRenameValue('');
  };

  const commitRename = async (): Promise<void> => {
    const target = renameTarget();
    const title = renameValue().trim();
    if (!target || !title) return;
    try {
      if (target.kind === 'document') await renameUserLibraryDocument(target.id, title);
      else await renameUserLibraryFolder(target.id, title);
      cancelRename();
      refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось переименовать.');
    }
  };

  const createFolder = async (): Promise<void> => {
    const title = folderTitle().trim();
    if (!title) return;
    try {
      await createUserLibraryFolder(title, currentFolderId());
      setFolderTitle('');
      setCreatingFolder(false);
      refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось создать папку.');
    }
  };

  const moveDocument = async (documentId: string, folderId: string | null): Promise<void> => {
    try {
      await moveUserLibraryDocument(documentId, folderId);
      refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось переместить документ.');
    }
  };

  const moveFolder = async (folderId: string, parentId: string | null): Promise<void> => {
    try {
      await moveUserLibraryFolder(folderId, parentId);
      refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось переместить папку.');
    }
  };

  const requestOcr = async (
    document: UserLibraryDocument,
    quality: UserLibraryOcrQuality,
  ): Promise<void> => {
    try {
      await requestUserLibraryOcr(document.id, quality);
      toast.success('Документ поднят в начало очереди OCR.');
      refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось запустить OCR.');
    }
  };

  const moveDocumentActions = (document: UserLibraryDocument): readonly AppContextMenuAction[] => [
    {
      id: 'root',
      label: 'Без папки',
      icon: 'house',
      disabled: (document.folderId ?? null) === null,
      onSelect: () => void moveDocument(document.id, null),
    },
    ...folders().map((folder) => ({
      id: folder.id,
      label: folder.title,
      icon: 'folder-open' as const,
      disabled: document.folderId === folder.id,
      onSelect: () => void moveDocument(document.id, folder.id),
    })),
  ];

  const moveFolderActions = (folder: UserLibraryFolder): readonly AppContextMenuAction[] => {
    const excluded = folderDescendants(folders(), folder.id);
    excluded.add(folder.id);
    return [
      {
        id: 'root',
        label: 'В корень',
        icon: 'house',
        disabled: folder.parentId === null,
        onSelect: () => void moveFolder(folder.id, null),
      },
      ...folders()
        .filter((candidate) => !excluded.has(candidate.id))
        .map((candidate) => ({
          id: candidate.id,
          label: candidate.title,
          icon: 'folder-open' as const,
          disabled: folder.parentId === candidate.id,
          onSelect: () => void moveFolder(folder.id, candidate.id),
        })),
    ];
  };

  const documentActions = (document: UserLibraryDocument): readonly AppContextMenuAction[] => [
    {
      id: 'rename',
      label: 'Переименовать',
      icon: 'edit',
      onSelect: () => startRename({ kind: 'document', id: document.id, title: document.title }),
    },
    {
      id: 'move',
      label: 'Переместить',
      icon: 'folder-open',
      children: moveDocumentActions(document),
    },
    ...(isUserLibraryVisualMime(document.mimeType)
      ? [
          {
            id: 'ocr',
            label: document.status === 'ocr' ? 'Распознать в приоритете' : 'Распознать текст',
            icon: 'file-text' as const,
            children: [
              { id: 'ocr-fast', label: 'Быстро', onSelect: () => void requestOcr(document, 'fast') },
              { id: 'ocr-balanced', label: 'Обычно', onSelect: () => void requestOcr(document, 'balanced') },
              { id: 'ocr-quality', label: 'Качественно', onSelect: () => void requestOcr(document, 'quality') },
            ],
          } satisfies AppContextMenuAction,
        ]
      : []),
    {
      id: 'delete',
      label: 'Удалить',
      icon: 'trash',
      danger: true,
      onSelect: () => setDeleteTarget({ kind: 'document', id: document.id, title: document.title }),
    },
  ];

  const folderActions = (folder: UserLibraryFolder): readonly AppContextMenuAction[] => [
    {
      id: 'rename',
      label: 'Переименовать',
      icon: 'edit',
      onSelect: () => startRename({ kind: 'folder', id: folder.id, title: folder.title }),
    },
    {
      id: 'move',
      label: 'Переместить',
      icon: 'folder-open',
      children: moveFolderActions(folder),
    },
    {
      id: 'delete',
      label: 'Удалить папку',
      icon: 'trash',
      danger: true,
      onSelect: () => setDeleteTarget({ kind: 'folder', id: folder.id, title: folder.title }),
    },
  ];

  const confirmDelete = (): void => {
    const target = deleteTarget();
    if (!target) return;
    setDeleteTarget(null);
    void (async () => {
      try {
        if (target.kind === 'document') await removeUserLibraryDocument(target.id);
        else await removeUserLibraryFolder(target.id);
        refresh();
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : 'Не удалось удалить.');
      }
    })();
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
          label="Поиск по текущей папке"
          hideLabel
          placeholder="Название или файл"
        />
      </div>

      <AppBreadcrumbs
        items={[{ label: 'Документы', href: '#/modules/documents' }, { label: 'Ваши документы' }]}
        onNavigate={navigate}
      />
      <div class="user-library-page__title-row">
        <div>
          <h1 class="user-library-page__title">Ваши документы</h1>
          <p class="user-library-page__kicker">Только на этом устройстве. Не официальный источник.</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          class="user-library-page__new-folder"
          onClick={() => setCreatingFolder((value) => !value)}
          icon={<AppGlyph name="folder-open" />}
        >
          Новая папка
        </Button>
      </div>

      <nav class="user-library-breadcrumbs" aria-label="Папки библиотеки">
        <button
          type="button"
          classList={{ active: currentFolderId() === null }}
          onClick={() => setCurrentFolderId(null)}
        >
          Ваши файлы
        </button>
        <For each={folderTrail()}>
          {(folder) => (
            <>
              <span aria-hidden="true">/</span>
              <button
                type="button"
                classList={{ active: currentFolderId() === folder.id }}
                onClick={() => setCurrentFolderId(folder.id)}
              >
                {folder.title}
              </button>
            </>
          )}
        </For>
      </nav>

      <Show when={creatingFolder()}>
        <form
          class="user-library-folder-create paper-card"
          onSubmit={(event) => {
            event.preventDefault();
            void createFolder();
          }}
        >
          <AppGlyph name="folder-open" class="user-library-folder-create__icon" />
          <input
            type="text"
            value={folderTitle()}
            placeholder="Название папки"
            aria-label="Название новой папки"
            autofocus
            onInput={(event) => setFolderTitle(event.currentTarget.value)}
          />
          <Button type="submit" variant="primary" disabled={!folderTitle().trim()}>Создать</Button>
          <Button type="button" variant="quiet" onClick={() => setCreatingFolder(false)}>Отмена</Button>
        </form>
      </Show>

      <UserLibraryPicker
        dragging={dragging}
        setDragging={setDragging}
        onFiles={(files) => void appendFiles(files)}
      />

      <Show when={visibleFolders().length > 0}>
        <div class="user-library-folder-grid">
          <For each={visibleFolders()}>
            {(folder) => (
              <AppContextMenu
                actions={folderActions(folder)}
                buttonLabel={`Действия с папкой «${folder.title}»`}
              >
                <article
                  class="user-library-folder-card paper-card"
                  onDragOver={(event) => {
                    if (event.dataTransfer?.types.includes('application/x-minimed-document-id')) {
                      event.preventDefault();
                    }
                  }}
                  onDrop={(event) => {
                    const documentId = event.dataTransfer?.getData('application/x-minimed-document-id');
                    if (!documentId) return;
                    event.preventDefault();
                    void moveDocument(documentId, folder.id);
                  }}
                >
                  <Show
                    when={renameTarget()?.kind === 'folder' && renameTarget()?.id === folder.id}
                    fallback={
                      <button
                        type="button"
                        class="user-library-folder-card__open"
                        onClick={() => setCurrentFolderId(folder.id)}
                      >
                        <AppGlyph name="folder-open" class="user-library-folder-card__icon" />
                        <strong>{folder.title}</strong>
                        <small>
                          {folders().filter((item) => item.parentId === folder.id).length} папок ·{' '}
                          {documents().filter((item) => item.folderId === folder.id).length} файлов
                        </small>
                      </button>
                    }
                  >
                    <div class="user-library-card__rename-row">
                      <input
                        class="user-library-card__rename"
                        type="text"
                        value={renameValue()}
                        aria-label="Новое название папки"
                        ref={(element) => queueMicrotask(() => element.focus())}
                        onInput={(event) => setRenameValue(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void commitRename();
                          if (event.key === 'Escape') cancelRename();
                        }}
                      />
                      <Button
                        type="button"
                        variant="icon"
                        class="user-library-card__icon-action"
                        aria-label="Сохранить"
                        onClick={() => void commitRename()}
                        icon={<AppGlyph name="check" class="user-library-card__icon" />}
                      />
                    </div>
                  </Show>
                </article>
              </AppContextMenu>
            )}
          </For>
        </div>
      </Show>

      <Show
        when={visibleDocuments().length > 0}
        fallback={
          <Show when={visibleFolders().length === 0}>
            <p class="user-library-page__empty">
              {searchQuery().trim()
                ? 'Ничего не найдено по вашему запросу.'
                : currentFolderId()
                  ? 'Эта папка пока пуста.'
                  : 'Загрузите документ — он останется только на этом устройстве.'}
            </p>
          </Show>
        }
      >
        <div class="user-library-page__list">
          <LayoutVirtualizedGrid data={visibleDocuments()} bufferSize={500}>
            {(libraryDocument) => {
              const progress = (): number => userLibraryProgressFraction(libraryDocument);
              const renaming = (): boolean =>
                renameTarget()?.kind === 'document' && renameTarget()?.id === libraryDocument.id;
              return (
                <AppContextMenu
                  actions={documentActions(libraryDocument)}
                  buttonLabel={`Действия с документом «${libraryDocument.title}»`}
                >
                  <article
                    class="user-library-card paper-card"
                    draggable={libraryDocument.status !== 'inspecting'}
                    onDragStart={(event) => {
                      event.dataTransfer?.setData(
                        'application/x-minimed-document-id',
                        libraryDocument.id,
                      );
                      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                    }}
                  >
                    <Show
                      when={renaming()}
                      fallback={
                        <button
                          type="button"
                          class="user-library-card__open"
                          disabled={libraryDocument.status === 'inspecting'}
                          aria-disabled={libraryDocument.status === 'inspecting'}
                          onClick={() => {
                            if (libraryDocument.status === 'inspecting') return;
                            openUserLibraryDocument({
                              documentId: libraryDocument.id,
                              title: libraryDocument.title,
                            });
                          }}
                        >
                          <span class="user-library-card__title-row">
                            <Show when={libraryDocument.hasImages}>
                              <AppGlyph name="image" class="user-library-card__media-icon" />
                            </Show>
                            <strong class="user-library-card__title">{libraryDocument.title}</strong>
                          </span>
                          <span class="user-library-card__file-name">{libraryDocument.fileName}</span>
                          <span class="user-library-card__progress">
                            {statusLabel(libraryDocument, activeOcrId())}
                          </span>
                          <Show
                            when={libraryDocument.status === 'inspecting' || libraryDocument.status === 'ocr'}
                          >
                            <progress
                              class="user-library-card__progress-bar"
                              max={1}
                              value={progress()}
                            />
                          </Show>
                        </button>
                      }
                    >
                      <div class="user-library-card__rename-row">
                        <input
                          class="user-library-card__rename"
                          type="text"
                          value={renameValue()}
                          aria-label="Название документа"
                          ref={(element) => queueMicrotask(() => element.focus())}
                          onInput={(event) => setRenameValue(event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void commitRename();
                            if (event.key === 'Escape') cancelRename();
                          }}
                        />
                        <Button
                          type="button"
                          variant="icon"
                          class="user-library-card__icon-action"
                          aria-label="Подтвердить название"
                          onClick={() => void commitRename()}
                          icon={<AppGlyph name="check" class="user-library-card__icon" />}
                        />
                      </div>
                    </Show>
                  </article>
                </AppContextMenu>
              );
            }}
          </LayoutVirtualizedGrid>
        </div>
      </Show>

      <ConfirmationDialog
        open={Boolean(deleteTarget())}
        title={deleteTarget()?.kind === 'folder' ? 'Удалить папку?' : 'Удалить документ?'}
        description={
          <span>
            {deleteTarget()?.kind === 'folder'
              ? `Папка «${deleteTarget()?.title ?? ''}» будет удалена. Файлы и вложенные папки останутся и переместятся уровнем выше.`
              : `Файл «${deleteTarget()?.title ?? ''}» и извлечённый текст будут удалены только с этого устройства.`}
          </span>
        }
        confirmLabel="Удалить"
        danger
        onConfirm={confirmDelete}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      />
    </section>
  );
}
