import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppContextMenu, type AppContextMenuAction } from '@/components/AppContextMenu';
import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { LayoutVirtualizedGrid } from '@/components/LayoutVirtualizedGrid';
import { NavBack } from '@/components/NavBack';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SearchField } from '@/components/SearchField';
import { useStickySurface } from '@/components/sticky-surface';
import { userQuestionnairePath } from '@/features/assessments/assessment-routing';
import { createLibraryDropHandlers, FOLDER_DRAG_TYPE } from '@/features/library/user-library-drag';
import {
  openUserLibraryDocument,
  parseUserLibraryFolderRoute,
  userLibraryFolderHash,
} from '@/features/library/user-library-routing';
import { notesTemplatesPath } from '@/features/notes/notes-routing';
import { matchesFuzzyQuery } from '@/state/fuzzy-text';
import { shareSystemFile } from '@/state/native-share';
import { syncPatientNotesToUserLibrary } from '@/state/note-library-sync';
import {
  addUserLibraryFile,
  createUserLibraryFolder,
  createUserLibraryPdfFromImages,
  downloadUserLibraryExample,
  ensureUserLibraryThumbnail,
  getUserLibraryFile,
  isUserLibraryArchive,
  isUserLibraryImageMime,
  isUserLibraryOcrSupported,
  isUserLibraryQuestionnaire,
  isUserLibrarySystemFolder,
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
  setUserLibraryDocumentColor,
  setUserLibraryFolderColor,
  USER_LIBRARY_BOOKS_FOLDER_ID,
  USER_LIBRARY_COLORS,
  USER_LIBRARY_EVENT,
  USER_LIBRARY_EXAMPLE_SLOTS,
  USER_LIBRARY_NAME_MAX_LENGTH,
  USER_LIBRARY_NOTES_FOLDER_ID,
  USER_LIBRARY_QUESTIONNAIRES_FOLDER_ID,
  USER_LIBRARY_RESEARCH_FOLDER_ID,
  USER_LIBRARY_TEMPLATES_FOLDER_ID,
  type UserLibraryColor,
  type UserLibraryDocument,
  type UserLibraryExampleId,
  type UserLibraryExampleSlot,
  type UserLibraryFileKind,
  type UserLibraryFolder,
  type UserLibraryOcrQuality,
  userLibraryFileKind,
  userLibraryProgressFraction,
} from '@/state/user-library';
import { unpackUserLibraryArchive } from '@/state/user-library-archives';

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

const USER_LIBRARY_COLOR_LABEL: Record<UserLibraryColor, string> = {
  red: 'Красный',
  orange: 'Оранжевый',
  yellow: 'Жёлтый',
  green: 'Зелёный',
  blue: 'Синий',
  purple: 'Фиолетовый',
  gray: 'Серый',
};

function userLibraryColorActions(
  currentColor: UserLibraryColor | undefined,
  onSelect: (color: UserLibraryColor | null) => void,
): readonly AppContextMenuAction[] {
  return [
    {
      id: 'none',
      label: 'Без цвета',
      icon: 'circle',
      iconClass: 'app-context-menu__item-icon--color-none',
      onSelect: () => onSelect(null),
    },
    ...USER_LIBRARY_COLORS.map((color) => ({
      id: color,
      label:
        currentColor === color
          ? `${USER_LIBRARY_COLOR_LABEL[color]} ✓`
          : USER_LIBRARY_COLOR_LABEL[color],
      icon: 'circle' as const,
      iconClass: `app-context-menu__item-icon--color-${color}`,
      onSelect: () => onSelect(color),
    })),
  ];
}

function userLibraryColorAction(
  currentColor: UserLibraryColor | undefined,
  onSelect: (color: UserLibraryColor | null) => void,
): AppContextMenuAction {
  return {
    id: 'color',
    label: currentColor ? `Цвет: ${USER_LIBRARY_COLOR_LABEL[currentColor]}` : 'Цвет',
    icon: 'palette',
    children: userLibraryColorActions(currentColor, onSelect),
  };
}

function breadcrumbLabel(value: string): string {
  const characters = [...value];
  return characters.length > 16 ? `${characters.slice(0, 15).join('')}…` : value;
}

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
  questionnaire: 'list-checks',
  pdf: 'file-pdf',
  dicom: 'disc',
  volume: 'disc',
  image: 'image',
  video: 'film-slate',
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
  dicom: 5,
  volume: 6,
  ebook: 7,
  image: 8,
  text: 9,
  code: 10,
  audio: 11,
  video: 12,
  archive: 13,
  binary: 14,
  questionnaire: 15,
};

const USER_LIBRARY_FOLDER_GLYPHS: Readonly<Record<string, AppGlyphName>> = {
  [USER_LIBRARY_BOOKS_FOLDER_ID]: 'book-open',
  [USER_LIBRARY_RESEARCH_FOLDER_ID]: 'microscope',
  [USER_LIBRARY_QUESTIONNAIRES_FOLDER_ID]: 'list-checks',
  [USER_LIBRARY_TEMPLATES_FOLDER_ID]: 'notepad',
  [USER_LIBRARY_NOTES_FOLDER_ID]: 'notes',
};

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
    const textLayer = document.hasTextLayer ? 'Текстовый слой найден · ' : '';
    return `${textLayer}${formatFileSize(document.byteLength)} · изменён ${formatDateTime(document.updatedAt)}`;
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

function isExampleSlotFilled(
  slot: UserLibraryExampleSlot,
  documents: readonly UserLibraryDocument[],
): boolean {
  return documents.some(
    (document) => document.exampleId === slot.id || document.fileName === slot.fileName,
  );
}

interface LibraryEntry {
  readonly key: string;
  readonly kind: 'folder' | 'document';
  readonly title: string;
  readonly updatedAt: string;
  readonly folder?: UserLibraryFolder;
  readonly document?: UserLibraryDocument;
  readonly example?: UserLibraryExampleSlot;
}

interface ExampleUploadState {
  readonly progress: number;
  readonly uploading: boolean;
  readonly error?: string;
}

interface TouchDragSource {
  readonly kind: 'document' | 'folder';
  readonly id: string;
  readonly key: string;
}

function canUseNativeLibraryDrag(): boolean {
  return typeof window === 'undefined' || window.matchMedia('(pointer: fine)').matches;
}

function libraryDropTargetAt(clientX: number, clientY: number): string | null | undefined {
  const element = document.elementFromPoint(clientX, clientY);
  const target = element?.closest<HTMLElement>('[data-user-library-drop-target]');
  if (!target) return undefined;
  const folderId = target.getAttribute('data-user-library-drop-target');
  return folderId === 'root' ? null : folderId || undefined;
}

function UserLibraryAttachmentPreview(props: {
  readonly document: UserLibraryDocument;
}): JSX.Element {
  const [source, setSource] = createSignal<string>();
  const [decodeFailed, setDecodeFailed] = createSignal(false);
  let previewHost: HTMLSpanElement | undefined;
  let observer: IntersectionObserver | undefined;
  let idleCallback: number | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let started = false;

  const loadPreview = (): void => {
    if (started) return;
    started = true;
    void ensureUserLibraryThumbnail(props.document)
      .then((preview) => {
        if (!disposed && preview) setSource(preview);
      })
      .catch(() => {
        if (!disposed) setDecodeFailed(true);
      });
  };

  const schedulePreview = (): void => {
    if ('requestIdleCallback' in window) {
      idleCallback = window.requestIdleCallback(loadPreview, { timeout: 500 });
    } else {
      idleTimer = setTimeout(loadPreview, 0);
    }
  };

  onMount(() => {
    if (!previewHost || typeof IntersectionObserver !== 'function') {
      schedulePreview();
      return;
    }
    observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer?.disconnect();
        observer = undefined;
        schedulePreview();
      },
      { rootMargin: '360px 0px' },
    );
    observer.observe(previewHost);
  });
  onCleanup(() => {
    disposed = true;
    observer?.disconnect();
    if (idleCallback !== undefined) window.cancelIdleCallback(idleCallback);
    if (idleTimer !== undefined) window.clearTimeout(idleTimer);
  });

  // HEIC and other platform-specific formats may fail to decode — fall back to
  // the kind glyph by dropping the broken <img>.
  return (
    <span
      ref={(element) => {
        previewHost = element;
      }}
      class="user-library-card__preview-sentinel"
      aria-hidden="true"
    >
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
    </span>
  );
}

export function UserLibraryPage(): JSX.Element {
  const folderIdFromLocation = (): string | null => {
    const folderId = parseUserLibraryFolderRoute(window.location.hash.replace(/^#\/?/u, ''));
    return folderId === USER_LIBRARY_TEMPLATES_FOLDER_ID ? null : folderId;
  };
  const [documents, setDocuments] = createSignal<readonly UserLibraryDocument[]>([]);
  const [folders, setFolders] = createSignal<readonly UserLibraryFolder[]>([]);
  const [exampleUploads, setExampleUploads] = createSignal<
    Partial<Record<UserLibraryExampleId, ExampleUploadState>>
  >({});
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
  const [creatingPdf, setCreatingPdf] = createSignal(false);
  const [viewMode, setViewMode] = createSignal<'grid' | 'list'>(initialViewMode());
  const [sortMode, setSortMode] = createSignal<SortMode>(initialSortMode());
  const [draggingKey, setDraggingKey] = createSignal<string | null>(null);
  const [mediaDocument, setMediaDocument] = createSignal<UserLibraryDocument | null>(null);
  const [mediaUrl, setMediaUrl] = createSignal('');
  function initialViewMode(): 'grid' | 'list' {
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

  const refresh = async (): Promise<void> => {
    const generation = ++refreshGeneration;
    try {
      const [nextDocuments, nextFolders] = await Promise.all([
        listUserLibraryDocuments(),
        listUserLibraryFolders(),
      ]);
      if (generation !== refreshGeneration) return;
      setDocuments((previous) =>
        libraryListsEqual(previous, nextDocuments) ? previous : nextDocuments,
      );
      setFolders((previous) => (libraryListsEqual(previous, nextFolders) ? previous : nextFolders));
      const current = currentFolderId();
      if (current && !nextFolders.some((folder) => folder.id === current)) {
        setCurrentFolderId(null);
      }
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Не удалось прочитать личную библиотеку.',
      );
    }
  };

  onMount(() => {
    const syncFolderFromLocation = (): void => {
      const requestedFolderId = parseUserLibraryFolderRoute(
        window.location.hash.replace(/^#\/?/u, ''),
      );
      if (requestedFolderId === USER_LIBRARY_TEMPLATES_FOLDER_ID) {
        window.location.hash = notesTemplatesPath();
        return;
      }
      const nextFolderId = requestedFolderId;
      if (nextFolderId !== currentFolderId()) setCurrentFolderId(nextFolderId);
    };
    syncFolderFromLocation();
    refresh();
    window.addEventListener(USER_LIBRARY_EVENT, refresh);
    let cancelled = false;
    const syncNotes = async (): Promise<void> => {
      try {
        await syncPatientNotesToUserLibrary();
      } catch (cause) {
        if (!cancelled) {
          console.warn(
            cause instanceof Error
              ? `Не удалось синхронизировать заметки с файлами: ${cause.message}`
              : 'Не удалось синхронизировать заметки с файлами.',
          );
        }
      }
    };
    const runNoteSync = (): void => {
      idleCallback = undefined;
      idleTimer = undefined;
      if (!cancelled) void syncNotes();
    };
    let idleCallback: number | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    if ('requestIdleCallback' in window) {
      idleCallback = window.requestIdleCallback(runNoteSync, { timeout: 2000 });
    } else {
      idleTimer = setTimeout(runNoteSync, 1000);
    }
    window.addEventListener('hashchange', syncFolderFromLocation);
    onCleanup(() => {
      cancelled = true;
      if (idleCallback !== undefined) window.cancelIdleCallback(idleCallback);
      if (idleTimer !== undefined) window.clearTimeout(idleTimer);
      window.removeEventListener('hashchange', syncFolderFromLocation);
    });
  });
  onCleanup(() => window.removeEventListener(USER_LIBRARY_EVENT, refresh));

  const activeOcrId = createMemo(() => activeOcrDocumentId(documents()));

  const selectedDocuments = createMemo(() =>
    documents().filter((document) => selectedIds().has(document.id)),
  );
  const selectionTotalBytes = createMemo(() =>
    selectedDocuments().reduce((sum, document) => sum + document.byteLength, 0),
  );
  const selectedImageDocuments = createMemo(() =>
    selectedDocuments().filter((document) => isUserLibraryImageMime(document.mimeType)),
  );
  const canCreatePdfFromSelection = createMemo(
    () =>
      selectedDocuments().length > 0 &&
      selectedImageDocuments().length === selectedDocuments().length,
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

  const downloadDocument = async (record: UserLibraryDocument): Promise<void> => {
    try {
      const blob = await getUserLibraryFile(record.id);
      if (!blob) throw new Error('Файл недоступен.');
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
  };

  const downloadSelected = async (): Promise<void> => {
    for (const record of selectedDocuments()) await downloadDocument(record);
  };

  const createPdfFileName = (title: string): string => {
    const suffix = '.pdf';
    const base = [...title.trim()].slice(0, USER_LIBRARY_NAME_MAX_LENGTH - suffix.length).join('');
    return `${base || 'Фотографии'}${suffix}`;
  };

  const createPdfFromImages = async (
    images: readonly UserLibraryDocument[],
    title: string,
    folderId: string | null,
  ): Promise<void> => {
    if (creatingPdf() || images.length === 0) return;
    setCreatingPdf(true);
    const fileName = createPdfFileName(title);
    try {
      await createUserLibraryPdfFromImages(images, fileName, folderId);
      toast.success(`Создан PDF: ${fileName}.`);
      setSelectionMode(false);
      setSelectedIds(new Set<string>());
      refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось создать PDF.');
    } finally {
      setCreatingPdf(false);
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

  let lastInteractedKey: string | null = null;
  let stopTouchDrag: () => void = () => undefined;
  let touchDragActive = false;
  let suppressTouchContextMenuUntil = 0;

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
    folders().filter(
      (folder) =>
        folder.parentId === currentFolderId() && folder.id !== USER_LIBRARY_TEMPLATES_FOLDER_ID,
    ),
  );
  const visibleDocuments = createMemo(() => {
    const query = searchQuery().trim();
    return documents().filter((document) => {
      if ((document.folderId ?? null) !== currentFolderId()) return false;
      return !query || matchesFuzzyQuery(query, [document.title, document.fileName]);
    });
  });
  const visibleExampleSlots = createMemo(() => {
    const query = searchQuery().trim();
    return USER_LIBRARY_EXAMPLE_SLOTS.filter(
      (slot) =>
        slot.folderId === currentFolderId() &&
        !isExampleSlotFilled(slot, documents()) &&
        (!query || matchesFuzzyQuery(query, [slot.title, slot.fileName])),
    );
  });
  const imageDocumentsForFolder = (folderId: string): readonly UserLibraryDocument[] => {
    const childDocuments = documents().filter((document) => document.folderId === folderId);
    if (
      childDocuments.length === 0 ||
      folders().some((folder) => folder.parentId === folderId) ||
      childDocuments.some((document) => !isUserLibraryImageMime(document.mimeType))
    ) {
      return [];
    }
    return childDocuments;
  };

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
    const exampleEntries = visibleExampleSlots().map(
      (example): LibraryEntry => ({
        key: `example:${example.id}`,
        kind: 'document',
        title: example.title,
        updatedAt: '9999-12-31T23:59:59.999Z',
        example,
      }),
    );
    const mode = sortMode();
    return [...folderEntries, ...documentEntries, ...exampleEntries].toSorted((left, right) => {
      if (mode === 'name') return left.title.localeCompare(right.title, 'ru-RU');
      if (mode === 'type') {
        const rankOf = (entry: LibraryEntry): number => {
          if (entry.kind === 'folder') return FILE_KIND_SORT_RANK.folder;
          const kind = entry.example
            ? userLibraryFileKind(entry.example.mimeType, entry.example.fileName)
            : entry.document
              ? userLibraryFileKind(entry.document.mimeType, entry.document.fileName)
              : 'binary';
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

  const updateExampleUpload = (
    id: UserLibraryExampleId,
    state: ExampleUploadState | null,
  ): void => {
    setExampleUploads((current) => {
      const next = { ...current };
      if (state) next[id] = state;
      else delete next[id];
      return next;
    });
  };

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

  const downloadExample = async (slot: UserLibraryExampleSlot): Promise<void> => {
    if (exampleUploads()[slot.id]?.uploading) return;
    updateExampleUpload(slot.id, { progress: 0, uploading: true });
    try {
      await downloadUserLibraryExample(slot, (progress) =>
        updateExampleUpload(slot.id, { progress, uploading: true }),
      );
      await refresh();
      updateExampleUpload(slot.id, null);
      toast.success(`Добавлен пример «${slot.title}».`);
    } catch (cause) {
      updateExampleUpload(slot.id, {
        progress: 0,
        uploading: false,
        error: cause instanceof Error ? cause.message : 'Не удалось скачать пример.',
      });
      toast.error(cause instanceof Error ? cause.message : 'Не удалось скачать пример.');
    }
  };

  const openFilePicker = (): void => {
    if (fileInputElement) {
      fileInputElement.accept = '';
      fileInputElement.multiple = true;
      fileInputElement.click();
    }
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

  const preventTouchContextMenu = (event: MouseEvent): void => {
    if (event.target instanceof Element && event.target.closest('.app-context-menu__more')) return;
    if (!touchDragActive && performance.now() >= suppressTouchContextMenuUntil) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const startTouchDrag = (event: PointerEvent, source: TouchDragSource): void => {
    if (
      event.pointerType !== 'touch' ||
      selectionMode() ||
      (event.target instanceof Element &&
        event.target.closest(
          'input, textarea, select, .app-context-menu__more, .user-library-card__check, .user-library-card__rename-action, .user-library-card__icon-action',
        ))
    ) {
      return;
    }

    stopTouchDrag();
    const item = event.currentTarget;
    if (!(item instanceof HTMLElement)) return;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    let finished = false;
    let timer = 0;
    let dropFrame: number | undefined;
    let pendingDropPoint: { readonly x: number; readonly y: number } | undefined;

    const cleanup = (): void => {
      window.clearTimeout(timer);
      if (dropFrame !== undefined) cancelAnimationFrame(dropFrame);
      dropFrame = undefined;
      pendingDropPoint = undefined;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (dragging) {
        setDraggingKey(null);
        setDragTarget(undefined);
        document.body.classList.remove('user-library-touch-dragging');
        touchDragActive = false;
      }
      if (stopTouchDrag === cancel) stopTouchDrag = () => undefined;
    };

    const updateDropTarget = (clientX: number, clientY: number): string | null | undefined => {
      const target = libraryDropTargetAt(clientX, clientY);
      if (target !== undefined) setDragTarget(target);
      return target;
    };

    const scheduleDropTarget = (clientX: number, clientY: number): void => {
      pendingDropPoint = { x: clientX, y: clientY };
      if (dropFrame !== undefined) return;
      dropFrame = requestAnimationFrame(() => {
        dropFrame = undefined;
        const point = pendingDropPoint;
        pendingDropPoint = undefined;
        if (point) updateDropTarget(point.x, point.y);
      });
    };

    const finish = (drop: boolean, releaseEvent?: PointerEvent): void => {
      if (finished) return;
      finished = true;
      const wasDragging = dragging;
      const target =
        wasDragging && drop && releaseEvent
          ? updateDropTarget(releaseEvent.clientX, releaseEvent.clientY)
          : undefined;
      if (wasDragging && releaseEvent) {
        releaseEvent.preventDefault();
        releaseEvent.stopPropagation();
        suppressTouchContextMenuUntil = performance.now() + 600;
      }
      cleanup();
      if (!wasDragging) return;
      lastInteractedKey = source.key;
      if (target === undefined) return;
      if (source.kind === 'document') void moveDocument(source.id, target);
      else void moveFolder(source.id, target);
    };

    const cancel = (): void => finish(false);
    const onMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!dragging) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 8) cancel();
        return;
      }
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      scheduleDropTarget(moveEvent.clientX, moveEvent.clientY);
    };
    const onUp = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId === pointerId) finish(true, upEvent);
    };
    const onCancel = (cancelEvent: PointerEvent): void => {
      if (cancelEvent.pointerId === pointerId) cancel();
    };

    timer = window.setTimeout(() => {
      if (finished) return;
      dragging = true;
      touchDragActive = true;
      setDraggingKey(source.key);
      document.body.classList.add('user-library-touch-dragging');
      try {
        item.setPointerCapture(pointerId);
      } catch {
        // Pointer capture is optional; window listeners still finish the drag.
      }
      updateDropTarget(startX, startY);
    }, 350);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    stopTouchDrag = cancel;
  };

  onCleanup(() => stopTouchDrag());

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

  const unpackArchive = async (document: UserLibraryDocument): Promise<void> => {
    try {
      const result = await unpackUserLibraryArchive(document.id);
      toast.success(
        `Распаковано файлов: ${result.files}${result.folders > 0 ? `, папок: ${result.folders}` : ''}.`,
      );
      refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось распаковать архив.');
    }
  };

  const shareDocument = async (document: UserLibraryDocument): Promise<void> => {
    try {
      const blob = await getUserLibraryFile(document.id);
      if (!blob) throw new Error('Файл недоступен.');
      await shareSystemFile({
        title: document.title,
        fileName: document.fileName || document.title,
        mimeType: document.mimeType,
        blob,
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось отправить файл.');
    }
  };

  const changeDocumentColor = async (
    document: UserLibraryDocument,
    color: UserLibraryColor | null,
  ): Promise<void> => {
    try {
      await setUserLibraryDocumentColor(document.id, color);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось изменить цвет файла.');
    }
  };

  const changeFolderColor = async (
    folder: UserLibraryFolder,
    color: UserLibraryColor | null,
  ): Promise<void> => {
    try {
      await setUserLibraryFolderColor(folder.id, color);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось изменить цвет папки.');
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
      id: 'download',
      label: 'Сохранить на устройство',
      icon: 'download',
      onSelect: () => void downloadDocument(document),
    },
    {
      id: 'share',
      label: 'Отправить',
      icon: 'envelope-simple',
      onSelect: () => void shareDocument(document),
    },
    ...(isUserLibraryArchive(document.fileName)
      ? [
          {
            id: 'unpack',
            label: 'Распаковать',
            icon: 'archive' as const,
            onSelect: () => void unpackArchive(document),
          } satisfies AppContextMenuAction,
        ]
      : []),
    {
      id: 'move',
      label: 'Переместить',
      icon: 'folder-open',
      children: moveDocumentActions(document),
    },
    userLibraryColorAction(document.color, (color) => void changeDocumentColor(document, color)),
    ...(isUserLibraryOcrSupported(document.mimeType, document.fileName)
      ? [
          {
            id: 'ocr',
            label: 'Распознать текст',
            icon: 'file-text' as const,
            children: [
              {
                id: 'ocr-fast',
                label: 'Быстро',
                icon: 'clock',
                onSelect: () => void requestOcr(document, 'fast'),
              },
              {
                id: 'ocr-balanced',
                label: 'Обычно',
                icon: 'notches',
                onSelect: () => void requestOcr(document, 'balanced'),
              },
              {
                id: 'ocr-quality',
                label: 'Качественно',
                icon: 'magnifying-glass-plus',
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

  const folderActions = (folder: UserLibraryFolder): readonly AppContextMenuAction[] => {
    if (isUserLibrarySystemFolder(folder)) {
      return [
        userLibraryColorAction(folder.color, (color) => void changeFolderColor(folder, color)),
        {
          id: 'system',
          label: 'Системная папка: нельзя удалить или переместить',
          icon: 'folder-open',
          disabled: true,
        },
      ];
    }
    const images = imageDocumentsForFolder(folder.id);
    return [
      ...(images.length > 0
        ? [
            {
              id: 'create-pdf',
              label: 'Создать PDF из фото',
              icon: 'file-pdf' as const,
              onSelect: () => void createPdfFromImages(images, folder.title, folder.parentId),
            } satisfies AppContextMenuAction,
          ]
        : []),
      userLibraryColorAction(folder.color, (color) => void changeFolderColor(folder, color)),
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
  };

  const pageActions = (): readonly AppContextMenuAction[] => [
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
      icon:
        sortMode() === mode
          ? 'check'
          : mode === 'time'
            ? 'clock'
            : mode === 'name'
              ? 'text-aa'
              : 'file-text',
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
    onMoveFolder: (folderId, parentId) => void moveFolder(folderId, parentId),
  });
  const folderDropsFor = (folderId: string) =>
    createLibraryDropHandlers({
      folderId: () => folderId,
      onDragActive: (active) => setDragTarget(active),
      onDragEnd: () => setDragTarget(undefined),
      onDropFiles: (files, target) => void appendFiles(files, target),
      onMoveDocument: (documentId, target) => void moveDocument(documentId, target),
      onMoveFolder: (source, target) => void moveFolder(source, target),
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
      if (isUserLibraryQuestionnaire(props.document)) {
        window.location.hash = userQuestionnairePath(props.document.id);
        return;
      }
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
            'user-library-card--colored': Boolean(props.document.color),
            'user-library-card--touch-dragging': draggingKey() === props.document.id,
            'user-library-card--selected': selectionMode() && selected(),
            'user-library-card--selecting': selectionMode(),
          }}
          data-library-color={props.document.color}
          draggable={
            canUseNativeLibraryDrag() && props.document.status !== 'inspecting' && !selectionMode()
          }
          onPointerDown={(event) =>
            startTouchDrag(event, {
              kind: 'document',
              id: props.document.id,
              key: props.document.id,
            })
          }
          onContextMenu={preventTouchContextMenu}
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
          <div
            class={`user-library-card__open user-library-card__open--${viewMode()}`}
            classList={{ 'user-library-card__open--colored': Boolean(props.document.color) }}
          >
            <span
              class={`user-library-card__figure user-library-card__figure--${viewMode()} user-library-kind--${kind()}`}
              classList={{ 'user-library-card__figure--colored': Boolean(props.document.color) }}
              data-library-color={props.document.color}
              aria-hidden="true"
            >
              <UserLibraryAttachmentPreview document={props.document} />
              <AppGlyph
                name={FILE_KIND_GLYPHS[kind()]}
                class={`user-library-card__figure-glyph user-library-card__figure-glyph--${kind()}`}
              />
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
                <strong class="user-library-card__file-name">{props.document.title}</strong>
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

  const LibraryExampleCard = (props: { readonly slot: UserLibraryExampleSlot }): JSX.Element => {
    const title = (): string => props.slot.title;
    const fileName = (): string => props.slot.fileName;
    const upload = (): ExampleUploadState | undefined => exampleUploads()[props.slot.id];
    const progressPercent = (): number => Math.round((upload()?.progress ?? 0) * 100);
    const actionLabel = (): string => `Скачать пример «${title()}»`;
    const addExample = (): void => {
      void downloadExample(props.slot);
    };
    return (
      <button
        type="button"
        class={`user-library-example-card paper-card user-library-example-card--${viewMode()}`}
        aria-busy={upload()?.uploading || undefined}
        aria-label={actionLabel()}
        onClick={addExample}
      >
        <span
          class={`user-library-example-card__open user-library-example-card__open--${viewMode()}`}
        >
          <span
            class={`user-library-example-card__figure user-library-example-card__figure--${viewMode()}`}
          >
            <Show
              when={upload()?.uploading}
              fallback={
                <span class="user-library-example-card__upload" aria-hidden="true">
                  <AppGlyph name="file-arrow-down" class="user-library-example-card__upload-icon" />
                </span>
              }
            >
              <span class="user-library-example-card__progress">
                <progress
                  class="user-library-example-card__progress-bar"
                  max={1}
                  value={upload()?.progress ?? 0}
                  aria-label={`Прогресс скачивания «${title()}»: ${progressPercent()}%`}
                  title={`Скачивание… ${progressPercent()}%`}
                />
              </span>
            </Show>
          </span>
          <span
            class={`user-library-example-card__text user-library-example-card__text--${viewMode()}`}
          >
            <strong class="user-library-example-card__file-name">{title()}</strong>
            <small
              class="user-library-example-card__meta"
              classList={{ 'user-library-example-card__meta--error': Boolean(upload()?.error) }}
              title={upload()?.error ?? fileName()}
            >
              {upload()?.uploading
                ? `Скачивание… ${progressPercent()}%`
                : (upload()?.error ?? fileName())}
            </small>
          </span>
        </span>
      </button>
    );
  };

  const LibraryFolderCard = (props: { readonly folder: UserLibraryFolder }): JSX.Element => {
    const renaming = (): boolean =>
      renameTarget()?.kind === 'folder' && renameTarget()?.id === props.folder.id;
    const fileCount = (): number =>
      documents().filter((item) => item.folderId === props.folder.id).length +
      USER_LIBRARY_EXAMPLE_SLOTS.filter(
        (slot) => slot.folderId === props.folder.id && !isExampleSlotFilled(slot, documents()),
      ).length;
    const attachmentCount = (): number =>
      fileCount() + folders().filter((item) => item.parentId === props.folder.id).length;
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
          data-library-color={props.folder.color}
          classList={{
            'user-library-folder-card--colored': Boolean(props.folder.color),
            'user-library-folder-card--drop-target': dragTarget() === props.folder.id,
            'user-library-folder-card--touch-dragging': draggingKey() === props.folder.id,
            'user-library-folder-card--system': isUserLibrarySystemFolder(props.folder),
          }}
          data-user-library-drop-target={props.folder.id}
          draggable={canUseNativeLibraryDrag() && !isUserLibrarySystemFolder(props.folder)}
          onPointerDown={(event) =>
            startTouchDrag(event, {
              kind: 'folder',
              id: props.folder.id,
              key: props.folder.id,
            })
          }
          onContextMenu={preventTouchContextMenu}
          onDragStart={(event) => {
            event.dataTransfer?.setData(FOLDER_DRAG_TYPE, props.folder.id);
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
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
              classList={{
                'user-library-folder-card__open--colored': Boolean(props.folder.color),
              }}
              aria-label={`Открыть папку «${props.folder.title}»`}
              onClick={(event) => {
                event.stopPropagation();
                openThisFolder();
              }}
            >
              <span
                class={`user-library-folder-card__figure user-library-folder-card__figure--${viewMode()}`}
                aria-hidden="true"
              >
                <span class="user-library-folder-card__back" />
                <Show when={fileCount() > 0}>
                  <span class="user-library-folder-card__document" />
                </Show>
                <span class="user-library-folder-card__front">
                  <Show when={USER_LIBRARY_FOLDER_GLYPHS[props.folder.id]}>
                    {(glyph) => (
                      <AppGlyph name={glyph()} class="user-library-folder-card__system-icon" />
                    )}
                  </Show>
                </span>
              </span>
              <Show
                when={viewMode() === 'list'}
                fallback={
                  <>
                    <strong
                      class={`user-library-folder-card__title user-library-folder-card__title--${viewMode()}`}
                    >
                      {props.folder.title}
                    </strong>
                    <small
                      class={`user-library-folder-card__details user-library-folder-card__details--${viewMode()}`}
                      title={timesTitleFor(props.folder)}
                    >
                      {attachmentCount()} вложений
                    </small>
                  </>
                }
              >
                <span class="user-library-card__text user-library-card__text--list">
                  <strong class="user-library-card__file-name">{props.folder.title}</strong>
                  <small class="user-library-card__meta" title={timesTitleFor(props.folder)}>
                    {attachmentCount()} вложений
                  </small>
                </span>
              </Show>
            </button>
          </Show>
        </article>
      </AppContextMenu>
    );
  };

  const timesTitleFor = (folder: UserLibraryFolder): string =>
    `Создана: ${formatDateTime(folder.createdAt)}`;

  const renderLibraryEntry = (entry: LibraryEntry): JSX.Element | null => {
    if (entry.folder) return <LibraryFolderCard folder={entry.folder} />;
    if (entry.example) return <LibraryExampleCard slot={entry.example} />;
    return entry.document ? <LibraryCard document={entry.document} /> : null;
  };

  const viewToggle = (): JSX.Element => (
    <fieldset
      class="user-library-view-toggle user-library-view-toggle--medium"
      classList={{
        'user-library-view-toggle--grid': viewMode() === 'grid',
        'user-library-view-toggle--list': viewMode() === 'list',
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
      <AppContextMenu actions={pageActions()} hideButton class="user-library-page__area-context">
        <div
          ref={setHeadingElement}
          class="user-library-page__search-chrome knowledge-subroute-heading knowledge-subroute-heading--blurred module-catalog-heading route-sticky-chrome"
        >
          <NavBack
            class="knowledge-back-button knowledge-subroute-heading__control"
            aria-label={searchQuery().length > 0 ? 'Очистить поиск' : backTargetLabel()}
            onClick={() => (searchQuery().length > 0 ? setSearchQuery('') : goUpFolderHierarchy())}
            icon={<AppGlyph name={searchQuery().length > 0 ? 'close' : 'arrow-left'} />}
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
              data-user-library-drop-target="root"
              aria-current={currentFolderId() === null ? 'page' : undefined}
              onClick={() => openFolder(null)}
              {...rootDrops}
            >
              <AppGlyph name="house" class="user-library-breadcrumbs__icon" />
              <span class="user-library-breadcrumbs__label">Ваши файлы</span>
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
                      data-user-library-drop-target={folder.id}
                      aria-current={currentFolderId() === folder.id ? 'page' : undefined}
                      onClick={() => openFolder(folder.id)}
                      {...drops}
                    >
                      <span class="user-library-breadcrumbs__label" title={folder.title}>
                        {breadcrumbLabel(folder.title)}
                      </span>
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
              actions={pageActions()}
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
                <div class="user-library-page__empty-context">
                  <button
                    type="button"
                    class="user-library-page__empty-state"
                    aria-label="Добавьте файлы"
                    onClick={openFilePicker}
                  >
                    <AppGlyph name="file-plus" class="user-library-page__empty-icon" />
                    <strong class="user-library-page__empty-title">Добавьте файлы</strong>
                  </button>
                </div>
              }
            >
              <p class="user-library-page__empty">Ничего не найдено по вашему запросу.</p>
            </Show>
          }
        >
          <div
            class="user-library-page__list"
            classList={{
              'user-library-page__list--grid': viewMode() === 'grid',
              'user-library-page__list--list': viewMode() === 'list',
            }}
          >
            <Show
              when={viewMode() === 'grid'}
              fallback={
                <LayoutVirtualizedGrid data={visibleEntries()} bufferSize={500} maxColumns={3}>
                  {(entry) => renderLibraryEntry(entry)}
                </LayoutVirtualizedGrid>
              }
            >
              <LayoutVirtualizedGrid
                data={visibleEntries()}
                bufferSize={500}
                maxColumns={6}
                minColumns={2}
              >
                {(entry) => renderLibraryEntry(entry)}
              </LayoutVirtualizedGrid>
            </Show>
          </div>
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
              class="user-library-selection-bar__pdf"
              aria-label="Создать PDF из выбранных фото"
              title={
                canCreatePdfFromSelection()
                  ? 'Создать PDF из выбранных фото'
                  : 'Выберите только фотографии'
              }
              disabled={!canCreatePdfFromSelection() || creatingPdf()}
              onClick={() =>
                void createPdfFromImages(selectedImageDocuments(), 'Фотографии', currentFolderId())
              }
            >
              <AppGlyph name="file-pdf" class="user-library-selection-bar__icon" />
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
