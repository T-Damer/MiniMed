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
import { toast } from 'solid-sonner';

import {
  AppContextMenu,
  type AppContextMenuAction,
  requestContextMenu,
} from '@/components/AppContextMenu';
import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { LayoutVirtualizedGrid } from '@/components/LayoutVirtualizedGrid';
import { NavBack } from '@/components/NavBack';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SearchField } from '@/components/SearchField';
import { useStickySurface } from '@/components/sticky-surface';
import { createLibraryDropHandlers } from '@/features/library/user-library-drag';
import {
  openUserLibraryDocument,
  parseUserLibraryFolderRoute,
  userLibraryFolderHash,
} from '@/features/library/user-library-routing';
import { matchesFuzzyQuery } from '@/state/fuzzy-text';
import {
  addUserLibraryFile,
  createUserLibraryFolder,
  getUserLibraryFile,
  isUserLibraryVisualMime,
  listUserLibraryDocuments,
  listUserLibraryFolders,
  markUserLibraryDocumentOpened,
  moveUserLibraryDocument,
  moveUserLibraryFolder,
  removeUserLibraryDocument,
  removeUserLibraryFolder,
  renameUserLibraryDocument,
  renameUserLibraryFolder,
  requestUserLibraryOcr,
  USER_LIBRARY_EVENT,
  type UserLibraryDocument,
  type UserLibraryFileKind,
  type UserLibraryFolder,
  type UserLibraryOcrQuality,
  userLibraryFileKind,
  userLibraryProgressFraction,
} from '@/state/user-library';
import { previewExtractor } from '@/state/thumbnails';

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

type SortMode = 'time' | 'name' | 'type';

const SORT_MODE_LABEL: Record<SortMode, string> = {
  time: 'По времени',
  name: 'По названию',
  type: 'По типу',
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} МБ`;
}

const DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDateTime(value: string | undefined): string {
  if (!value) return '';
  try {
    return DATE_FORMAT.format(new Date(value));
  } catch {
    return '';
  }
}

const FILE_KIND_GLYPHS: Record<UserLibraryFileKind, AppGlyphName> = {
  pdf: 'file-pdf',
  image: 'image',
  video: 'film-strip',
  audio: 'music-notes',
  archive: 'file-zip',
  code: 'code',
  presentation: 'file-ppt',
  sheet: 'file-xls',
  doc: 'file-doc',
  ebook: 'book-open',
  text: 'file-txt',
  binary: 'binary',
};

/** Folders lead, then Office colors-first kinds, everything else follows. */
const FILE_KIND_SORT_RANK: Record<UserLibraryFileKind | 'folder', number> = {
  folder: 0,
  presentation: 1,
  sheet: 2,
  doc: 3,
  pdf: 4,
  ebook: 5,
  image: 6,
  text: 7,
  code: 8,
  audio: 9,
  video: 10,
  archive: 11,
  binary: 12,
};

interface FreePosition {
  readonly x: number;
  readonly y: number;
}

const FREE_LAYOUT_PREFIX = 'minimed.freeLayout.';

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(96, Math.max(0, value));
}

function readFreeLayout(scope: string): Record<string, FreePosition> {
  try {
    const raw = localStorage.getItem(FREE_LAYOUT_PREFIX + scope);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const result: Record<string, FreePosition> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const candidate = value as Partial<FreePosition> | null;
      if (candidate && typeof candidate.x === 'number' && typeof candidate.y === 'number') {
        result[id] = { x: clampPercent(candidate.x), y: clampPercent(candidate.y) };
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writeFreeLayout(scope: string, positions: Readonly<Record<string, FreePosition>>): void {
  try {
    localStorage.setItem(FREE_LAYOUT_PREFIX + scope, JSON.stringify(positions));
  } catch {
    // ignore
  }
}

/** Reference-stability guard: keeps virtualizer rows from re-measuring when a
 * refresh brings back an identical list (e.g. unrelated library writes). */
function libraryListsEqual<T extends { readonly id: string; readonly updatedAt: string }>(
  previous: readonly T[],
  next: readonly T[],
): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  return previous.every((item, index) => {
    const other = next[index];
    return other && item.id === other.id && item.updatedAt === other.updatedAt;
  });
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
    return `${formatFileSize(document.byteLength)} · изменён ${formatDateTime(document.updatedAt)}`;
  }
  if (document.status === 'failed') {
    return document.errorMessage ?? 'Не удалось обработать файл';
  }
  if (document.id !== activeOcrId) return 'В очереди на распознавание текста';
  const done = document.nativeTextPages + document.ocrDonePages;
  return `Распознавание текста · ${done} / ${document.pageCount}`;
}

function folderDescendants(folders: readonly UserLibraryFolder[], folderId: string): Set<string> {
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

interface LibraryEntry {
  readonly key: string;
  readonly kind: 'folder' | 'document';
  readonly title: string;
  readonly updatedAt: string;
  readonly folder?: UserLibraryFolder;
  readonly document?: UserLibraryDocument;
}

function UserLibraryAttachmentPreview(props: {
  readonly document: UserLibraryDocument;
}): JSX.Element {
  const [source, setSource] = createSignal<string>();
  const [decodeFailed, setDecodeFailed] = createSignal(false);
  let disposed = false;

  onMount(() => {
    void getUserLibraryFile(props.document.id)
      .then(async (blob) => {
        if (!blob) return;
        const preview = await previewExtractor.forFile(
          blob,
          props.document.mimeType,
          props.document.fileName,
        );
        if (!disposed && preview) setSource(preview);
      })
      .catch(() => {
        if (!disposed) setDecodeFailed(true);
      });
  });
  onCleanup(() => {
    disposed = true;
  });

  // HEIC and other platform-specific formats may fail to decode — fall back to
  // the kind glyph by dropping the broken <img>.
  return (
    <Show when={!decodeFailed() ? source() : undefined} fallback={null}>
      {(url) => (
        <img
          class="user-library-card__preview-image"
          src={url()}
          alt=""
          draggable={false}
          onError={() => setDecodeFailed(true)}
        />
      )}
    </Show>
  );
}

export function UserLibraryPage(): JSX.Element {
  const folderIdFromLocation = (): string | null =>
    parseUserLibraryFolderRoute(window.location.hash.replace(/^#\/?/u, ''));
  const [documents, setDocuments] = createSignal<readonly UserLibraryDocument[]>([]);
  const [folders, setFolders] = createSignal<readonly UserLibraryFolder[]>([]);
  const [currentFolderId, setCurrentFolderId] = createSignal<string | null>(folderIdFromLocation());
  const [dragTarget, setDragTarget] = createSignal<string | null | undefined>(undefined);
  const [renameTarget, setRenameTarget] = createSignal<RenameTarget | null>(null);
  const [renameValue, setRenameValue] = createSignal('');
  const [searchQuery, setSearchQuery] = createSignal('');
  const [headingElement, setHeadingElement] = createSignal<HTMLElement | undefined>();
  const [creatingFolder, setCreatingFolder] = createSignal(false);
  const [folderTitle, setFolderTitle] = createSignal('');
  const [deleteTarget, setDeleteTarget] = createSignal<DeleteTarget | null>(null);
  const [selectionMode, setSelectionMode] = createSignal(false);
  const [selectedIds, setSelectedIds] = createSignal<ReadonlySet<string>>(new Set());
  const [confirmExitSelection, setConfirmExitSelection] = createSignal(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = createSignal(false);
  const [viewMode, setViewMode] = createSignal<'grid' | 'list' | 'free'>(initialViewMode());
  const [sortMode, setSortMode] = createSignal<SortMode>(initialSortMode());
  const [freePositions, setFreePositions] = createSignal<Readonly<Record<string, FreePosition>>>(
    {},
  );
  const [draggingKey, setDraggingKey] = createSignal<string | null>(null);
  const [mediaDocument, setMediaDocument] = createSignal<UserLibraryDocument | null>(null);
  const [mediaUrl, setMediaUrl] = createSignal('');
  function initialViewMode(): 'grid' | 'list' | 'free' {
    try {
      const stored = localStorage.getItem('minimed.libraryView');
      return stored === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  }
  function initialSortMode(): SortMode {
    try {
      const stored = localStorage.getItem('minimed.librarySort');
      return stored === 'name' || stored === 'type' ? stored : 'time';
    } catch {
      return 'time';
    }
  }
  const setViewModePersisted = (mode: 'grid' | 'list'): void => {
    setViewMode(mode);
    try {
      localStorage.setItem('minimed.libraryView', mode);
    } catch {
      // ignore
    }
  };
  const applySortMode = (mode: SortMode): void => {
    setSortMode(mode);
    try {
      localStorage.setItem('minimed.librarySort', mode);
    } catch {
      // ignore
    }
  };
  let fileInputElement: HTMLInputElement | undefined;
  let refreshGeneration = 0;

  useStickySurface(headingElement);

  const refresh = (): void => {
    const generation = ++refreshGeneration;
    void Promise.all([listUserLibraryDocuments(), listUserLibraryFolders()])
      .then(([nextDocuments, nextFolders]) => {
        if (generation !== refreshGeneration) return;
        setDocuments((previous) =>
          libraryListsEqual(previous, nextDocuments) ? previous : nextDocuments,
        );
        setFolders((previous) =>
          libraryListsEqual(previous, nextFolders) ? previous : nextFolders,
        );
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
    const syncFolderFromLocation = (): void => {
      const nextFolderId = folderIdFromLocation();
      if (nextFolderId !== currentFolderId()) setCurrentFolderId(nextFolderId);
    };
    syncFolderFromLocation();
    refresh();
    window.addEventListener(USER_LIBRARY_EVENT, refresh);
    window.addEventListener('hashchange', syncFolderFromLocation);
    onCleanup(() => window.removeEventListener('hashchange', syncFolderFromLocation));
  });
  onCleanup(() => window.removeEventListener(USER_LIBRARY_EVENT, refresh));

  const activeOcrId = createMemo(() => activeOcrDocumentId(documents()));

  const selectedDocuments = createMemo(() =>
    documents().filter((document) => selectedIds().has(document.id)),
  );
  const selectionTotalBytes = createMemo(() =>
    selectedDocuments().reduce((sum, document) => sum + document.byteLength, 0),
  );

  const enterDocumentSelection = (documentId: string): void => {
    setSelectionMode(true);
    setSelectedIds(new Set([documentId]));
  };

  const toggleDocumentSelection = (documentId: string): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  };

  const requestExitSelection = (): void => {
    if (selectedIds().size > 2) setConfirmExitSelection(true);
    else {
      setSelectionMode(false);
      setSelectedIds(new Set<string>());
    }
  };

  const downloadSelected = async (): Promise<void> => {
    for (const record of selectedDocuments()) {
      try {
        const blob = await getUserLibraryFile(record.id);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = record.fileName || record.title;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      } catch {
        toast.error(`Не удалось сохранить «${record.title}».`);
      }
    }
  };

  const bulkDeleteSelected = async (): Promise<void> => {
    setConfirmBulkDelete(false);
    const doomed = [...selectedIds()];
    try {
      for (const id of doomed) await removeUserLibraryDocument(id);
      toast.success(doomed.length === 1 ? 'Файл удалён.' : `Удалено файлов: ${doomed.length}.`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось удалить.');
    }
    setSelectionMode(false);
    setSelectedIds(new Set<string>());
    refresh();
  };

  const currentFolder = createMemo(() =>
    folders().find((folder) => folder.id === currentFolderId()),
  );

  let freeContainer: HTMLElement | undefined;
  let lastInteractedKey: string | null = null;

  createEffect(() => {
    if (viewMode() !== 'free') return;
    setFreePositions(readFreeLayout(currentFolderId() ?? 'root'));
  });

  const freePositionFor = (entryKey: string, index: number): FreePosition => {
    const stored = freePositions()[entryKey];
    if (stored) return stored;
    const rect = freeContainer?.getBoundingClientRect();
    const width = rect?.width || 800;
    const height = rect?.height || 600;
    // ponytail: fixed seed grid, upgrade to collision-aware packing if auto-layout becomes a requirement
    const tileWidth = Math.min(224, Math.max(160, width * 0.86));
    const gap = 24;
    const columns = Math.max(1, Math.floor((width + gap) / (tileWidth + gap)));
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      x: clampPercent(((column * (tileWidth + gap)) / width) * 100),
      y: clampPercent(((row * 168) / Math.max(1, height)) * 100),
    };
  };

  /**
   * Whole-block free drag: press anywhere outside an action control, and the
   * block follows the pointer. A clean tap (no movement) still opens the item
   * through the regular click path.
   */
  const startFreeDrag = (event: PointerEvent, entryKey: string): void => {
    if (selectionMode()) return;
    if (!freeContainer) return;
    const item = event.currentTarget;
    if (!(item instanceof HTMLElement)) return;
    // Text fields and action buttons keep their native pointer interaction;
    // the rest of the tile remains a drag handle.
    if (
      event.target instanceof Element &&
      event.target.closest(
        'input, textarea, select, .app-context-menu__more, .user-library-card__check, .user-library-card__rename-action',
      )
    )
      return;
    const containerRect = freeContainer.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = item.offsetLeft;
    const startTop = item.offsetTop;
    let moved = false;
    const onMove = (moveEvent: PointerEvent): void => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!moved && Math.hypot(dx, dy) <= 5) return;
      if (!moved) {
        moved = true;
        setDraggingKey(entryKey);
        try {
          item.setPointerCapture(moveEvent.pointerId);
        } catch {
          // ignore — drag continues without capture
        }
      }
      moveEvent.preventDefault();
      const x = clampPercent(((startLeft + dx) / containerRect.width) * 100);
      const y = clampPercent(((startTop + dy) / Math.max(1, containerRect.height)) * 100);
      setFreePositions((current) => ({ ...current, [entryKey]: { x, y } }));
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (moved) {
        lastInteractedKey = entryKey;
        writeFreeLayout(currentFolderId() ?? 'root', freePositions());
      }
      setDraggingKey(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  let mediaObjectUrl = '';
  let mediaRequestToken = 0;

  const closeMediaPlayer = (): void => {
    mediaRequestToken += 1;
    setMediaDocument(null);
    setMediaUrl('');
    if (mediaObjectUrl) {
      URL.revokeObjectURL(mediaObjectUrl);
      mediaObjectUrl = '';
    }
  };

  const openMediaPlayer = async (record: UserLibraryDocument): Promise<void> => {
    const token = ++mediaRequestToken;
    try {
      const blob = await getUserLibraryFile(record.id);
      if (!blob) throw new Error('Файл недоступен.');
      if (token !== mediaRequestToken) return;
      closeMediaPlayer();
      mediaObjectUrl = URL.createObjectURL(blob);
      setMediaDocument(record);
      setMediaUrl(mediaObjectUrl);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось открыть файл.');
    }
  };

  onCleanup(closeMediaPlayer);

  const mediaKind = createMemo((): UserLibraryFileKind => {
    const record = mediaDocument();
    return record ? userLibraryFileKind(record.mimeType, record.fileName) : 'binary';
  });

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

  /** Folders and files interleaved in one list, ordered by the chosen sort. */
  const visibleEntries = createMemo<readonly LibraryEntry[]>(() => {
    const query = searchQuery().trim();
    const folderEntries = visibleFolders()
      .filter((folder) => !query || matchesFuzzyQuery(query, [folder.title]))
      .map(
        (folder): LibraryEntry => ({
          key: folder.id,
          kind: 'folder',
          title: folder.title,
          updatedAt: folder.updatedAt,
          folder,
        }),
      );
    const documentEntries = visibleDocuments().map(
      (document): LibraryEntry => ({
        key: document.id,
        kind: 'document',
        title: document.title,
        updatedAt: document.updatedAt,
        document,
      }),
    );
    const mode = sortMode();
    return [...folderEntries, ...documentEntries].toSorted((left, right) => {
      if (mode === 'name') return left.title.localeCompare(right.title, 'ru-RU');
      if (mode === 'type') {
        const rankOf = (entry: LibraryEntry): number => {
          if (entry.kind === 'folder' || !entry.document) return FILE_KIND_SORT_RANK.folder;
          const kind = userLibraryFileKind(entry.document.mimeType, entry.document.fileName);
          return FILE_KIND_SORT_RANK[kind];
        };
        const leftRank = rankOf(left);
        const rightRank = rankOf(right);
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.title.localeCompare(right.title, 'ru-RU');
      }
      const byTime = right.updatedAt.localeCompare(left.updatedAt);
      return byTime !== 0 ? byTime : left.title.localeCompare(right.title, 'ru-RU');
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

  const appendFiles = async (
    files: FileList | null | undefined,
    folderId: string | null = currentFolderId(),
  ): Promise<void> => {
    let added = 0;
    for (const file of Array.from(files ?? [])) {
      try {
        await addUserLibraryFile(file, folderId);
        added += 1;
      } catch (cause) {
        if ((files?.length ?? 0) === 1) {
          toast.error(cause instanceof Error ? cause.message : 'Не удалось загрузить файл.');
        }
      }
    }
    const total = files?.length ?? 0;
    const failed = total - added;
    if (added > 0) toast.success(`Добавлено документов: ${added}.`);
    if (failed > 0) toast.error(`Не удалось добавить документов: ${failed}.`);
    refresh();
  };

  const openFilePicker = (): void => fileInputElement?.click();

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

  const submitCreateFolder = async (): Promise<void> => {
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
      const result = await requestUserLibraryOcr(document.id, quality);
      toast.success(
        result === 'pdf-copy'
          ? 'Создана PDF-копия изображения и запущено распознавание.'
          : 'Документ поднят в начало очереди OCR.',
      );
      refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось запустить OCR.');
    }
  };

  const moveDocumentActions = (document: UserLibraryDocument): readonly AppContextMenuAction[] => [
    {
      id: 'root',
      label: 'Home',
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
      id: 'select',
      label: 'Выбрать несколько',
      icon: 'check',
      onSelect: () => {
        if (selectionMode()) toggleDocumentSelection(document.id);
        else enterDocumentSelection(document.id);
      },
    },
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
            label: 'Распознать текст',
            icon: 'file-text' as const,
            children: [
              {
                id: 'ocr-fast',
                label: 'Быстро',
                onSelect: () => void requestOcr(document, 'fast'),
              },
              {
                id: 'ocr-balanced',
                label: 'Обычно',
                onSelect: () => void requestOcr(document, 'balanced'),
              },
              {
                id: 'ocr-quality',
                label: 'Качественно',
                onSelect: () => void requestOcr(document, 'quality'),
              },
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

  const pageActions: readonly AppContextMenuAction[] = [
    {
      id: 'folder',
      label: 'Создать папку',
      icon: 'folder-open',
      onSelect: () => {
        setFolderTitle('');
        setCreatingFolder(true);
      },
    },
    {
      id: 'file',
      label: 'Загрузить документы',
      icon: 'download',
      onSelect: openFilePicker,
    },
  ];

  const sortActions: readonly AppContextMenuAction[] = (['time', 'name', 'type'] as const).map(
    (mode) => ({
      id: mode,
      label: SORT_MODE_LABEL[mode],
      ...(sortMode() === mode ? { icon: 'check' } : {}),
      onSelect: () => applySortMode(mode),
    }),
  );

  const confirmDelete = (): void => {
    const target = deleteTarget();
    if (!target) return;
    setDeleteTarget(null);
    void (async () => {
      try {
        if (target.kind === 'document') {
          await removeUserLibraryDocument(target.id);
        } else {
          await removeUserLibraryFolder(target.id);
        }
        refresh();
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : 'Не удалось удалить.');
      }
    })();
  };

  const navigate = (href: string): void => {
    window.location.hash = href;
  };

  const openFolder = (folderId: string | null): void => {
    setSearchQuery('');
    setCurrentFolderId(folderId);
    const nextHash = userLibraryFolderHash(folderId);
    if (window.location.hash !== nextHash) window.location.hash = nextHash;
  };

  const goUpFolderHierarchy = (): void => {
    if (currentFolderId() === null) {
      navigate('#/modules/documents');
      return;
    }
    const parentId = currentFolder()?.parentId;
    openFolder(parentId ?? null);
  };

  const backTargetLabel = (): string => {
    if (currentFolderId() === null) return 'Назад к каталогу документов';
    const parentId = currentFolder()?.parentId;
    if (!parentId) return 'Назад к вашим файлам';
    const parent = folders().find((folder) => folder.id === parentId);
    return parent ? `Назад к папке «${parent.title}»` : 'Назад к каталогу документов';
  };

  const rootDrops = createLibraryDropHandlers({
    folderId: () => null,
    onDragActive: (folderId) => setDragTarget(folderId),
    onDragEnd: () => setDragTarget(undefined),
    onDropFiles: (files, folderId) => void appendFiles(files, folderId),
    onMoveDocument: (documentId, folderId) => void moveDocument(documentId, folderId),
  });
  const folderDropsFor = (folderId: string) =>
    createLibraryDropHandlers({
      folderId: () => folderId,
      onDragActive: (active) => setDragTarget(active),
      onDragEnd: () => setDragTarget(undefined),
      onDropFiles: (files, target) => void appendFiles(files, target),
      onMoveDocument: (documentId, target) => void moveDocument(documentId, target),
    });

  const LibraryCard = (props: { readonly document: UserLibraryDocument }): JSX.Element => {
    const progress = (): number => userLibraryProgressFraction(props.document);
    const renaming = (): boolean =>
      renameTarget()?.kind === 'document' && renameTarget()?.id === props.document.id;
    const selected = (): boolean => selectedIds().has(props.document.id);
    const kind = (): UserLibraryFileKind =>
      userLibraryFileKind(props.document.mimeType, props.document.fileName);
    const openDocumentCard = (): void => {
      if (lastInteractedKey === props.document.id) {
        lastInteractedKey = null;
        return;
      }
      if (renaming()) return;
      if (selectionMode()) {
        toggleDocumentSelection(props.document.id);
        return;
      }
      if (props.document.status === 'inspecting') return;
      void markUserLibraryDocumentOpened(props.document.id);
      if (kind() === 'video' || kind() === 'audio') {
        void openMediaPlayer(props.document);
        return;
      }
      openUserLibraryDocument({
        documentId: props.document.id,
        title: props.document.title,
      });
    };
    const handleCardActivation = (event: MouseEvent): void => {
      if (event.target instanceof Element && event.target.closest('button, input')) return;
      openDocumentCard();
    };
    const handleCardKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target instanceof Element && event.target.closest('button, input')) return;
      event.preventDefault();
      openDocumentCard();
    };
    const timesTitle = (): string =>
      [
        `Добавлен: ${formatDateTime(props.document.createdAt)}`,
        `Изменён: ${formatDateTime(props.document.updatedAt)}`,
        props.document.lastOpenedAt
          ? `Открыт: ${formatDateTime(props.document.lastOpenedAt)}`
          : 'Ещё не открывался',
      ].join('\n');
    return (
      <AppContextMenu
        class={`user-library-card-menu user-library-card-menu--${viewMode()}`}
        actions={documentActions(props.document)}
        buttonLabel={`Действия с документом «${props.document.title}»`}
        hideButton
      >
        <article
          class={`user-library-card paper-card user-library-card--${viewMode()}`}
          classList={{
            'user-library-card--selected': selectionMode() && selected(),
            'user-library-card--selecting': selectionMode(),
          }}
          draggable={
            viewMode() !== 'free' && props.document.status !== 'inspecting' && !selectionMode()
          }
          onClick={handleCardActivation}
          onKeyDown={handleCardKeyDown}
          onDragStart={(event) => {
            event.dataTransfer?.setData('application/x-minimed-document-id', props.document.id);
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
          }}
        >
          <Show when={selectionMode()}>
            <button
              type="button"
              class="user-library-card__check"
              aria-label={
                selected()
                  ? `Снять выбор «${props.document.title}»`
                  : `Выбрать «${props.document.title}»`
              }
              onClick={() => toggleDocumentSelection(props.document.id)}
            >
              <Show when={selected()}>
                <AppGlyph name="check" class="user-library-card__check-icon" />
              </Show>
            </button>
          </Show>
          <div class={`user-library-card__open user-library-card__open--${viewMode()}`}>
            <span
              class={`user-library-card__figure user-library-card__figure--${viewMode()} user-library-kind--${kind()}`}
              aria-hidden="true"
            >
              <UserLibraryAttachmentPreview document={props.document} />
              <AppGlyph name={FILE_KIND_GLYPHS[kind()]} class="user-library-card__figure-glyph" />
            </span>
            <span class={`user-library-card__text user-library-card__text--${viewMode()}`}>
              <Show
                when={!renaming()}
                fallback={
                  <input
                    class="user-library-card__title-edit"
                    type="text"
                    value={renameValue()}
                    aria-label="Название документа"
                    ref={(element) => queueMicrotask(() => element.focus())}
                    onInput={(event) => setRenameValue(event.currentTarget.value)}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void commitRename();
                      if (event.key === 'Escape') cancelRename();
                    }}
                  />
                }
              >
                <strong class="user-library-card__file-name">{props.document.fileName}</strong>
              </Show>
              <Show
                when={props.document.status === 'ready' || props.document.status === 'failed'}
                fallback={
                  <>
                    <small class="user-library-card__meta">
                      {statusLabel(props.document, activeOcrId())}
                    </small>
                    <Show
                      when={
                        props.document.status === 'inspecting' || props.document.status === 'ocr'
                      }
                    >
                      <progress
                        class="user-library-card__progress-bar"
                        max={1}
                        value={progress()}
                      />
                    </Show>
                  </>
                }
              >
                <small class="user-library-card__meta" title={timesTitle()}>
                  {statusLabel(props.document, activeOcrId())}
                </small>
              </Show>
            </span>
          </div>
          <Show when={renaming()}>
            <div class="user-library-card__rename-actions">
              <button
                type="button"
                class="user-library-card__rename-action user-library-card__rename-action--confirm"
                aria-label="Подтвердить название"
                title="Сохранить название"
                onClick={() => void commitRename()}
              >
                <AppGlyph name="check" class="user-library-card__icon" />
              </button>
              <button
                type="button"
                class="user-library-card__rename-action"
                aria-label="Отменить переименование"
                title="Вернуть прежнее название"
                onClick={cancelRename}
              >
                <AppGlyph name="close" class="user-library-card__icon" />
              </button>
            </div>
          </Show>
        </article>
      </AppContextMenu>
    );
  };

  const LibraryFolderCard = (props: { readonly folder: UserLibraryFolder }): JSX.Element => {
    const renaming = (): boolean =>
      renameTarget()?.kind === 'folder' && renameTarget()?.id === props.folder.id;
    const drops = folderDropsFor(props.folder.id);
    const openThisFolder = (): void => {
      if (lastInteractedKey === props.folder.id) {
        lastInteractedKey = null;
        return;
      }
      if (renaming()) return;
      openFolder(props.folder.id);
    };
    return (
      <AppContextMenu
        class={`user-library-folder-menu user-library-folder-menu--${viewMode()}`}
        actions={folderActions(props.folder)}
        buttonLabel={`Действия с папкой «${props.folder.title}»`}
        hideButton
      >
        <article
          class={`user-library-folder-card paper-card user-library-folder-card--${viewMode()}`}
          classList={{
            'user-library-folder-card--drop-target': dragTarget() === props.folder.id,
          }}
          {...drops}
        >
          <Show
            when={!renaming()}
            fallback={
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
            }
          >
            <button
              type="button"
              class={`user-library-folder-card__open user-library-folder-card__open--${viewMode()}`}
              aria-label={`Открыть папку «${props.folder.title}»`}
              onClick={(event) => {
                event.stopPropagation();
                openThisFolder();
              }}
            >
              <span
                class={`user-library-folder-card__figure user-library-folder-card__figure--${viewMode()}`}
                aria-hidden="true"
              />
              <strong
                class={`user-library-folder-card__title user-library-folder-card__title--${viewMode()}`}
              >
                {props.folder.title}
              </strong>
              <small
                class={`user-library-folder-card__details user-library-folder-card__details--${viewMode()}`}
                title={timesTitleFor(props.folder)}
              >
                {folders().filter((item) => item.parentId === props.folder.id).length} папок ·{' '}
                {documents().filter((item) => item.folderId === props.folder.id).length} файлов
              </small>
            </button>
          </Show>
        </article>
      </AppContextMenu>
    );
  };

  const timesTitleFor = (folder: UserLibraryFolder): string =>
    `Создана: ${formatDateTime(folder.createdAt)}`;

  const viewToggle = (): JSX.Element => (
    <fieldset
      class="user-library-view-toggle user-library-view-toggle--medium"
      classList={{
        'user-library-view-toggle--grid': viewMode() === 'grid',
        'user-library-view-toggle--list': viewMode() === 'list',
        'user-library-view-toggle--free': viewMode() === 'free',
      }}
      aria-label="Вид списка"
    >
      <span class="user-library-view-toggle__thumb" aria-hidden="true" />
      <button
        type="button"
        class="user-library-view-toggle__button"
        classList={{ 'user-library-view-toggle__button--on': viewMode() === 'grid' }}
        aria-label="Сетка"
        title="Сетка"
        aria-pressed={viewMode() === 'grid'}
        onClick={() => setViewModePersisted('grid')}
      >
        <AppGlyph name="squares-four" class="user-library-view-toggle__icon" />
      </button>
      <button
        type="button"
        class="user-library-view-toggle__button"
        classList={{ 'user-library-view-toggle__button--on': viewMode() === 'list' }}
        aria-label="Список"
        title="Список"
        aria-pressed={viewMode() === 'list'}
        onClick={() => setViewModePersisted('list')}
      >
        <AppGlyph name="list-dashes" class="user-library-view-toggle__icon" />
      </button>
    </fieldset>
  );

  const sortMenu = (): JSX.Element => (
    <AppContextMenu
      class="user-library-sort"
      buttonLabel={`Сортировка: ${SORT_MODE_LABEL[sortMode()]}`}
      buttonIcon="arrows-down-up"
      buttonClass="user-library-sort__trigger"
      actions={sortActions}
    >
      <span class="user-library-sort__anchor" aria-hidden="true" />
    </AppContextMenu>
  );

  return (
    <section class="user-library-page" aria-label="Ваши документы">
      <AppContextMenu actions={pageActions} hideButton class="user-library-page__area-context">
        <div
          ref={setHeadingElement}
          class="knowledge-subroute-heading knowledge-subroute-heading--blurred module-catalog-heading route-sticky-chrome"
        >
          <NavBack
            class="knowledge-back-button knowledge-subroute-heading__control"
            aria-label={backTargetLabel()}
            onClick={goUpFolderHierarchy}
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

        <div class="user-library-page__breadcrumb-row">
          <nav class="user-library-breadcrumbs" aria-label="Папки библиотеки">
            <button
              type="button"
              class="user-library-breadcrumbs__button"
              classList={{
                'user-library-breadcrumbs__button--active': currentFolderId() === null,
                'user-library-breadcrumbs__button--drop': dragTarget() === null,
              }}
              aria-current={currentFolderId() === null ? 'page' : undefined}
              onClick={() => openFolder(null)}
              {...rootDrops}
            >
              <AppGlyph name="house" class="user-library-breadcrumbs__icon" />
              Ваши файлы
            </button>
            <For each={folderTrail()}>
              {(folder) => {
                const drops = folderDropsFor(folder.id);
                return (
                  <>
                    <span class="user-library-breadcrumbs__separator" aria-hidden="true">
                      /
                    </span>
                    <button
                      type="button"
                      class="user-library-breadcrumbs__button"
                      classList={{
                        'user-library-breadcrumbs__button--active': currentFolderId() === folder.id,
                        'user-library-breadcrumbs__button--drop': dragTarget() === folder.id,
                      }}
                      aria-current={currentFolderId() === folder.id ? 'page' : undefined}
                      onClick={() => openFolder(folder.id)}
                      {...drops}
                    >
                      {folder.title}
                    </button>
                  </>
                );
              }}
            </For>
          </nav>
          <div class="user-library-page__breadcrumb-tools">
            {sortMenu()}
            {viewToggle()}
            <AppContextMenu
              actions={pageActions}
              class="user-library-page__page-actions"
              buttonClass="user-library-page__add-button"
              buttonIcon="plus"
              buttonLabel="Действия со страницей"
            >
              <span class="user-library-page__add-anchor" aria-hidden="true" />
            </AppContextMenu>
          </div>
        </div>
        <input
          ref={(element) => {
            fileInputElement = element;
          }}
          class="user-library-page__file-input"
          type="file"
          multiple
          aria-label="Загрузить документы"
          onChange={(event) => {
            void appendFiles(event.currentTarget.files);
            event.currentTarget.value = '';
          }}
        />

        <OverlayDialog
          open={creatingFolder()}
          title="Новая папка"
          onClose={() => setCreatingFolder(false)}
        >
          <form
            class="user-library-folder-create"
            onSubmit={(event) => {
              event.preventDefault();
              void submitCreateFolder();
            }}
          >
            <input
              type="text"
              value={folderTitle()}
              placeholder="Название папки"
              aria-label="Название новой папки"
              autofocus
              onInput={(event) => setFolderTitle(event.currentTarget.value)}
            />
            <div class="user-library-folder-create__actions">
              <Button type="submit" variant="primary" disabled={!folderTitle().trim()}>
                Создать
              </Button>
              <Button type="button" variant="quiet" onClick={() => setCreatingFolder(false)}>
                Отмена
              </Button>
            </div>
          </form>
        </OverlayDialog>

        <Show
          when={visibleEntries().length > 0}
          fallback={
            <Show
              when={searchQuery().trim()}
              fallback={
                <button
                  type="button"
                  class="user-library-page__empty-state"
                  aria-label="Загрузите документ или создайте папку"
                  onClick={requestContextMenu}
                >
                  <AppGlyph name="file-plus" class="user-library-page__empty-icon" />
                  <strong class="user-library-page__empty-title">
                    Загрузите документ или создайте папку
                  </strong>
                </button>
              }
            >
              <p class="user-library-page__empty">Ничего не найдено по вашему запросу.</p>
            </Show>
          }
        >
          <Show
            when={viewMode() === 'free'}
            fallback={
              <div
                class="user-library-page__list"
                classList={{
                  'user-library-page__list--grid': viewMode() === 'grid',
                  'user-library-page__list--list': viewMode() === 'list',
                }}
              >
                <LayoutVirtualizedGrid
                  data={visibleEntries()}
                  bufferSize={500}
                  maxColumns={3}
                  minTwoColumnWidth={320}
                >
                  {(entry) => {
                    if (entry.folder) return <LibraryFolderCard folder={entry.folder} />;
                    const document = entry.document;
                    return document ? <LibraryCard document={document} /> : null;
                  }}
                </LayoutVirtualizedGrid>
              </div>
            }
          >
            <div
              class="user-library-page__free"
              ref={(element) => {
                freeContainer = element;
              }}
            >
              <For each={visibleEntries()}>
                {(entry, index) => {
                  const position = (): FreePosition => freePositionFor(entry.key, index());
                  const card = entry.folder ? (
                    <LibraryFolderCard folder={entry.folder} />
                  ) : entry.document ? (
                    <LibraryCard document={entry.document} />
                  ) : null;
                  return (
                    <div
                      class="user-library-page__free-item"
                      classList={{
                        'user-library-page__free-item--dragging': draggingKey() === entry.key,
                      }}
                      style={{ left: `${position().x}%`, top: `${position().y}%` }}
                      onPointerDown={(event) => startFreeDrag(event, entry.key)}
                    >
                      {card}
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </Show>

        <Show when={selectionMode()}>
          <div class="user-library-selection-bar" role="toolbar" aria-label="Выбранные файлы">
            <button
              type="button"
              class="user-library-selection-bar__exit"
              aria-label="Отменить выделение"
              title="Отменить выделение"
              onClick={requestExitSelection}
            >
              <AppGlyph name="close" class="user-library-selection-bar__icon" />
            </button>
            <span class="user-library-selection-bar__summary">
              {selectedIds().size} · {formatFileSize(selectionTotalBytes())}
            </span>
            <button
              type="button"
              class="user-library-selection-bar__download"
              aria-label="Сохранить выбранные файлы"
              title="Сохранить на устройство"
              disabled={selectedIds().size === 0}
              onClick={() => void downloadSelected()}
            >
              <AppGlyph name="download" class="user-library-selection-bar__icon" />
            </button>
            <button
              type="button"
              class="user-library-selection-bar__delete"
              aria-label="Удалить выбранные файлы"
              title="Удалить выбранные"
              disabled={selectedIds().size === 0}
              onClick={() => setConfirmBulkDelete(true)}
            >
              <AppGlyph name="trash" class="user-library-selection-bar__icon" />
            </button>
          </div>
        </Show>

        <OverlayDialog
          open={Boolean(mediaDocument())}
          title={mediaDocument()?.fileName ?? ''}
          onClose={closeMediaPlayer}
        >
          <Show when={mediaUrl()}>
            {(url) => (
              <Show
                when={mediaKind() === 'video'}
                fallback={
                  <audio controls class="user-library-media-player" src={url()}>
                    <track kind="captions" label="Без субтитров" />
                  </audio>
                }
              >
                <video controls class="user-library-media-player" src={url()}>
                  <track kind="captions" label="Без субтитров" />
                </video>
              </Show>
            )}
          </Show>
        </OverlayDialog>

        <ConfirmationDialog
          open={confirmExitSelection()}
          title="Отменить выделение?"
          description="Вы точно хотите отменить выделение?"
          confirmLabel="Да, отменить"
          onConfirm={() => {
            setConfirmExitSelection(false);
            setSelectionMode(false);
            setSelectedIds(new Set<string>());
          }}
          onOpenChange={(open) => {
            if (!open) setConfirmExitSelection(false);
          }}
        />

        <ConfirmationDialog
          open={confirmBulkDelete()}
          title={
            selectedIds().size === 1 ? 'Удалить файл?' : `Удалить файлы (${selectedIds().size})?`
          }
          description={
            <span>
              Выбранные файлы и извлечённый текст будут удалены только с этого устройства.
            </span>
          }
          confirmLabel="Удалить"
          danger
          onConfirm={() => void bulkDeleteSelected()}
          onOpenChange={(open) => {
            if (!open) setConfirmBulkDelete(false);
          }}
        />

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
      </AppContextMenu>
    </section>
  );
}
