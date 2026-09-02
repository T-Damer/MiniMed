import type { TextRange } from '@localmed/contracts';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  lazy,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { toast } from 'solid-sonner';

import { AppBreadcrumbs } from '@/components/AppBreadcrumbs';
import { AppContextMenu, type AppContextMenuAction } from '@/components/AppContextMenu';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { DocumentCrumbs } from '@/components/DocumentCrumbs';
import { QueryHighlightedText } from '@/components/HighlightedText';
import { OverlayDialog } from '@/components/OverlayDialog';
import { DocumentFindBar, type DocumentFindResultState } from '@/features/library/DocumentFindBar';
import { type DocumentFindUnit, rangesForFindUnit } from '@/features/library/document-find';
import { navigateDocumentReaderBack } from '@/features/library/document-reader-back';
import {
  DocumentReaderChromeShell,
  useDocumentReaderChrome,
} from '@/features/library/document-reader-chrome';
import {
  markMedicalImageViewerActive,
  markUserDocumentPdf,
  setTwoPageMode,
  useDocumentBookReadingMode,
} from '@/features/library/document-reading-mode';
import { MediaViewer } from '@/features/library/document-rich-block';
import { LazyPdfCanvas } from '@/features/library/LazyPdfCanvas';
import { PaginatedTextEditor } from '@/features/library/PaginatedTextEditor';
import { PinchZoomSurface } from '@/features/library/PinchZoomSurface';
import { PINCH_ZOOM_MAX, PINCH_ZOOM_MIN } from '@/features/library/pinch-zoom-math';
import { isRichDocumentMime, RichDocumentRenderer } from '@/features/library/RichDocumentRenderer';
import {
  type ParsedMarkdownDocument,
  parseMarkdownDocument,
  parseMarkdownDocumentAsync,
  SafeMarkdown,
} from '@/features/library/SafeMarkdown';
import { sheetAnchorId } from '@/features/library/SpreadsheetRenderer';
import { UserDocumentHighlights } from '@/features/library/UserDocumentHighlights';
import { usePinchZoom } from '@/features/library/use-pinch-zoom';
import {
  buildUserDocumentOutlineItems,
  buildUserDocumentPrintHtml,
  escapePrintHtml,
  pageAnchorId,
  pageCanvasId,
} from '@/features/library/user-document-reader-helpers';
import { USER_LIBRARY_CATALOG_HASH } from '@/features/library/user-library-routing';
import { NoteMarkdownEditor } from '@/features/notes/NoteMarkdownEditor';
import { PrintManager } from '@/features/printing/print-manager';
import type { DocumentTrail } from '@/state/document-trail';
import { setMedicalImageStatusBar } from '@/state/native-system-ui';
import { loadPdfJsDocument, type PdfDocumentProxy } from '@/state/pdfjs-document';
import {
  addUserLibraryFile,
  getUserLibraryDocument,
  getUserLibraryFile,
  isUserLibraryDicomFile,
  isUserLibraryImageMime,
  isUserLibraryPdfMime,
  isUserLibraryTextLikeMime,
  isUserLibraryVolumeFile,
  listUserLibraryPages,
  saveUserLibraryDraft,
  USER_LIBRARY_EVENT,
  USER_LIBRARY_TEMPLATES_FOLDER_ID,
  type UserLibraryDocument,
  type UserLibraryPage,
  type UserLibraryWordBox,
  userLibraryFileAccept,
  userLibraryFileCapability,
  userLibraryProgressFraction,
} from '@/state/user-library';
import type { UserLibraryReaderAction } from '@/state/user-library-capabilities';
import { isEditableUserLibraryFile } from '@/state/user-library-formats';
import { joinUserLibraryTextPages } from '@/state/user-library-text-pages';

const DicomViewer = lazy(() => import('@/features/library/DicomViewer'));
const VolumeViewer = lazy(() => import('@/features/library/VolumeViewer'));

interface UserDocumentReaderProps {
  readonly documentId: string;
  readonly initialPageIndex?: number;
  readonly trail?: DocumentTrail | null;
  readonly origin?: {
    readonly catalogLabel: string;
    readonly catalogHref: string;
  };
  readonly onNavigate?: (href: string) => void;
  readonly onTitle?: (title: string) => void;
}

const emptyFindState: DocumentFindResultState = {
  query: '',
  mode: 'exact',
  matches: [],
  activeIndex: 0,
  loading: false,
};

function statusBanner(libraryDocument: UserLibraryDocument): string {
  if (libraryDocument.status === 'inspecting') {
    return 'Читаем файл… Страницы и текст появятся после первичного разбора.';
  }
  if (libraryDocument.status === 'ocr') {
    const done = libraryDocument.nativeTextPages + libraryDocument.ocrDonePages;
    return (
      'Распознаём текст: ' +
      done +
      ' из ' +
      libraryDocument.pageCount +
      ' страниц. Документ можно читать уже сейчас.'
    );
  }
  return '';
}

function navigateHref(props: UserDocumentReaderProps, href: string): void {
  if (props.onNavigate) {
    props.onNavigate(href);
    return;
  }
  window.location.hash = href;
}

function wordUnitId(pageAnchor: string, wordIndex: number): string {
  return `${pageAnchor}:${wordIndex}`;
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Не удалось подготовить изображение к печати.'));
    reader.onerror = () => reject(new Error('Не удалось подготовить изображение к печати.'));
    reader.readAsDataURL(blob);
  });
}

function WordOverlay(props: {
  readonly pageAnchor: string;
  readonly words: readonly UserLibraryWordBox[];
  readonly interactive: boolean;
  readonly hitUnitIds: () => ReadonlySet<string>;
  readonly activeUnitId: () => string | undefined;
}): JSX.Element {
  return (
    <div
      class="user-document-reader__word-layer"
      classList={{ 'user-document-reader__word-layer--selection-disabled': !props.interactive }}
    >
      <For each={props.words}>
        {(word, index) => {
          const unitId = () => wordUnitId(props.pageAnchor, index());
          return (
            <span
              class="user-document-reader__word"
              classList={{
                'user-document-reader__word--hit': props.hitUnitIds().has(unitId()),
                'user-document-reader__word--current': props.activeUnitId() === unitId(),
                'user-document-reader__word--selection-disabled': !props.interactive,
              }}
              style={{
                left: `${String(word.x * 100)}%`,
                top: `${String(word.y * 100)}%`,
                width: `${String(word.w * 100)}%`,
                height: `${String(word.h * 100)}%`,
              }}
            >
              {word.text}
            </span>
          );
        }}
      </For>
    </div>
  );
}

export function UserDocumentReader(props: UserDocumentReaderProps): JSX.Element {
  const origin = props.origin;
  const [libraryDocument, setLibraryDocument] = createSignal<UserLibraryDocument | null>(null);
  const [pages, setPages] = createSignal<readonly UserLibraryPage[]>([]);
  const [pdfPageCount, setPdfPageCount] = createSignal(0);
  const [pdfDocument, setPdfDocument] = createSignal<PdfDocumentProxy | null>(null);
  const [imageUrl, setImageUrl] = createSignal<string | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [findState, setFindState] = createSignal<DocumentFindResultState>(emptyFindState);
  const [findOpen, setFindOpen] = createSignal(false);
  const [fullscreen, setFullscreen] = createSignal(false);
  const [draftOpen, setDraftOpen] = createSignal(false);
  const [draftText, setDraftText] = createSignal('');
  const [draftDirty, setDraftDirty] = createSignal(false);
  const [draftSaving, setDraftSaving] = createSignal(false);
  const [draftError, setDraftError] = createSignal<string | null>(null);
  const [discardOpen, setDiscardOpen] = createSignal(false);
  const [leaveAction, setLeaveAction] = createSignal<'close' | 'navigate' | null>(null);
  const [pendingNavigation, setPendingNavigation] = createSignal<string | null>(null);
  const [imageLightboxOpen, setImageLightboxOpen] = createSignal(false);
  const [presentationPreviewSlide, setPresentationPreviewSlide] = createSignal<HTMLElement | null>(
    null,
  );
  const [sheetNames, setSheetNames] = createSignal<readonly string[]>([]);
  const [activeSheetName, setActiveSheetName] = createSignal('');
  const [parsedMarkdown, setParsedMarkdown] = createSignal<ParsedMarkdownDocument | null>(null);
  let activePdf: PdfDocumentProxy | null = null;
  let pdfLoadGeneration = 0;
  let markdownParseGeneration = 0;
  let draftFileInput: HTMLInputElement | undefined;
  const pdfZoom = usePinchZoom({ expandScrollPort: true, lockHorizontalPan: true });

  const meta = (): UserLibraryDocument | null => libraryDocument();
  const readerCapability = createMemo(() => {
    const current = meta();
    return userLibraryFileCapability(current?.mimeType ?? '', current?.fileName ?? '');
  });
  const hasReaderAction = (action: UserLibraryReaderAction): boolean =>
    readerCapability().reader.actions.includes(action);
  const isTemplateDocument = (): boolean => meta()?.folderId === USER_LIBRARY_TEMPLATES_FOLDER_ID;
  const isMarkdown = (): boolean => readerCapability().reader.renderer === 'markdown';
  const isSheet = (): boolean => readerCapability().reader.renderer === 'sheet';
  const isDicom = (): boolean => {
    const current = meta();
    return current ? isUserLibraryDicomFile(current.mimeType, current.fileName) : false;
  };
  const isVolume = (): boolean => {
    const current = meta();
    return current ? isUserLibraryVolumeFile(current.mimeType, current.fileName) : false;
  };
  const isMedicalImage = (): boolean => isDicom() || isVolume();
  const markdownText = createMemo(() =>
    pages()
      .map((page) => page.text)
      .join('\n'),
  );
  const draftSourceText = createMemo(() => {
    const pageTexts = pages().map((page) => page.text);
    return readerCapability().reader.renderer === 'docx'
      ? joinUserLibraryTextPages(pageTexts)
      : pageTexts.join('\n');
  });
  const markdownAnchor = createMemo(() => {
    const firstPage = pages()[0];
    return firstPage ? pageAnchorId(props.documentId, firstPage.pageIndex) : undefined;
  });
  createEffect(() => {
    const source = isMarkdown() ? markdownText() : '';
    const generation = ++markdownParseGeneration;
    setParsedMarkdown(null);
    void parseMarkdownDocumentAsync(source)
      .then((parsed) => {
        if (generation === markdownParseGeneration) setParsedMarkdown(parsed);
      })
      .catch(() => {
        if (generation === markdownParseGeneration)
          setParsedMarkdown(parseMarkdownDocument(source));
      });
    onCleanup(() => {
      if (generation === markdownParseGeneration) markdownParseGeneration += 1;
    });
  });
  const editableSource = createMemo(() => {
    const current = meta();
    return current ? isEditableUserLibraryFile(current.fileName, current.mimeType) : false;
  });
  const draftFormatHint = (): string => {
    const current = meta();
    if (!current) return '';
    if (/\.docx$/iu.test(current.fileName)) {
      return 'Разрывы страниц сохранены. Сложное форматирование исходного файла не переносится: сохранится текстовый черновик в том же формате.';
    }
    if (/\.rtf$/iu.test(current.fileName)) {
      return 'Сложное форматирование исходного файла не переносится: сохранится текстовый черновик в том же формате.';
    }
    return 'Изменения остаются черновиком и попадут в файл только после явного сохранения.';
  };

  const openDraftFiles = (): void => draftFileInput?.click();

  const handleDraftFiles = (files: FileList | null): void => {
    const folderId = meta()?.folderId ?? null;
    for (const file of Array.from(files ?? [])) {
      void addUserLibraryFile(file, folderId)
        .then(() => toast.success(`Файл «${file.name}» добавлен.`))
        .catch((cause: unknown) => {
          toast.error(cause instanceof Error ? cause.message : 'Не удалось добавить файл.');
        });
    }
  };

  const outlineItems = createMemo(() => {
    const current = meta();
    if (!current) return [];
    if (isMarkdown()) return parsedMarkdown()?.outline ?? [];
    if (isSheet()) {
      return sheetNames().map((sheetName) => ({
        anchor: sheetAnchorId(current.id, sheetName),
        label: sheetName,
        depth: 1,
        searchTexts: [sheetName],
      }));
    }
    return buildUserDocumentOutlineItems(
      current.mimeType,
      pages(),
      isUserLibraryPdfMime(current.mimeType)
        ? { documentId: current.id, visualPageCount: pdfPageCount() }
        : { documentId: current.id },
    );
  });

  const findUnits = createMemo((): readonly DocumentFindUnit[] => {
    const current = meta();
    if (!current) return [];
    const titleUnit: DocumentFindUnit = { id: current.id, text: current.title };
    if (isUserLibraryTextLikeMime(current.mimeType, current.fileName)) {
      return [
        titleUnit,
        ...pages().map((page) => ({
          id: pageAnchorId(page.documentId, page.pageIndex),
          text: page.text,
        })),
      ];
    }
    if (isUserLibraryPdfMime(current.mimeType) || isUserLibraryImageMime(current.mimeType)) {
      const units: DocumentFindUnit[] = [titleUnit];
      const pageIndexes =
        isUserLibraryPdfMime(current.mimeType) && pdfPageCount() > 0
          ? Array.from({ length: pdfPageCount() }, (_, index) => index)
          : [0];
      const pagesByIndex = new Map<number, UserLibraryPage>();
      for (const page of pages()) {
        if (!pagesByIndex.has(page.pageIndex)) pagesByIndex.set(page.pageIndex, page);
      }
      for (const pageIndex of pageIndexes) {
        const anchor = pageAnchorId(current.id, pageIndex);
        const page = pagesByIndex.get(pageIndex);
        const words = page?.words ?? [];
        words.forEach((word, wordIndex) => {
          units.push({ id: wordUnitId(anchor, wordIndex), text: word.text });
        });
      }
      return units;
    }
    return [titleUnit];
  });

  const findSearchable = createMemo(() => {
    const current = meta();
    if (!current) return false;
    const searchKind = readerCapability().reader.search;
    if (searchKind === 'none') return false;
    if (searchKind === 'text') {
      return pages().some((page) => page.text.trim().length > 0);
    }
    return pages().some(
      (page) =>
        page.text.trim().length > 0 ||
        (page.words?.some((word) => word.text.trim().length > 0) ?? false),
    );
  });
  createEffect(() => {
    const medicalImageActive = isMedicalImage();
    markMedicalImageViewerActive(medicalImageActive);
    setMedicalImageStatusBar(medicalImageActive);
  });
  onCleanup(() => {
    markMedicalImageViewerActive(false);
    setMedicalImageStatusBar(false);
  });
  const readingMode = useDocumentBookReadingMode();
  const bookReadingMode = createMemo(
    () => readingMode.bookMode() && hasReaderAction('reading-mode'),
  );

  createEffect(() => {
    if (!isPdf()) return;
    pdfDocument();
    readingMode.twoPageMode();
    pdfZoom.reset();
  });

  createEffect(() => {
    if (!fullscreen()) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setFullscreen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    onCleanup(() => window.removeEventListener('keydown', closeOnEscape));
  });

  const chrome = useDocumentReaderChrome({
    sectionSelector: '[data-user-doc-anchor]',
    outlineItemAttr: 'data-outline-anchor',
    scrollSpyWhen: () => Boolean(meta()) && outlineItems().length > 0,
  });

  const handleSheetNamesChange = (names: readonly string[]): void => {
    setSheetNames(names);
    const next = names.includes(activeSheetName()) ? activeSheetName() : (names[0] ?? '');
    setActiveSheetName(next);
    if (next) chrome.setActiveAnchor(sheetAnchorId(props.documentId, next));
  };

  const handleActiveSheetChange = (name: string): void => {
    setActiveSheetName(name);
    chrome.setActiveAnchor(sheetAnchorId(props.documentId, name));
  };

  const findMatches = createMemo(() => findState().matches);
  const rangesByUnit = createMemo(() => {
    const map = new Map<string, TextRange[]>();
    for (const match of findMatches()) {
      const existing = map.get(match.unitId) ?? [];
      existing.push({ start: match.start, end: match.end });
      map.set(match.unitId, existing);
    }
    return map;
  });

  const hitUnitIds = createMemo(() => new Set(findMatches().map((match) => match.unitId)));

  const activeMatch = createMemo(() => {
    const matches = findMatches();
    const state = findState();
    return matches[state.activeIndex];
  });
  let lastScrolledMatchKey = '';

  createEffect(() => {
    const match = activeMatch();
    const state = findState();
    if (!match || state.loading) {
      if (state.loading) lastScrolledMatchKey = '';
      return;
    }
    const key = `${match.unitId}:${String(match.start)}:${String(state.activeIndex)}`;
    if (key === lastScrolledMatchKey) return;
    lastScrolledMatchKey = key;
    requestAnimationFrame(() => {
      const current = meta();
      if (!current) return;
      if (isUserLibraryTextLikeMime(current.mimeType, current.fileName)) {
        const paper = globalThis.document.querySelector<HTMLElement>(
          '.user-document-reader__paper',
        );
        const mark = paper?.querySelector<HTMLElement>(
          `[data-document-find-unit="${CSS.escape(match.unitId)}"][data-document-find-start="${String(match.start)}"]`,
        );
        if (mark) {
          mark.scrollIntoView({ behavior: 'auto', block: 'center' });
          return;
        }
        globalThis.document.getElementById(match.unitId)?.scrollIntoView({
          behavior: 'auto',
          block: 'center',
        });
        return;
      }
      const word = globalThis.document.querySelector<HTMLElement>(
        '.user-document-reader__word--current',
      );
      word?.scrollIntoView({ behavior: 'auto', block: 'center' });
    });
  });

  const replacePdf = async (blob: Blob): Promise<void> => {
    const generation = ++pdfLoadGeneration;
    const next = await loadPdfJsDocument(blob);
    if (generation !== pdfLoadGeneration) {
      await next.destroy();
      return;
    }
    const previous = activePdf;
    activePdf = next;
    setPdfDocument(next);
    setPdfPageCount(next.numPages);
    if (previous && previous !== next) await previous.destroy();
  };

  const refresh = async (reloadFile = false): Promise<void> => {
    const loadedMeta = await getUserLibraryDocument(props.documentId);
    setLibraryDocument(loadedMeta);
    if (!loadedMeta) {
      setLoadError('Личный документ больше недоступен.');
      return;
    }
    props.onTitle?.(loadedMeta.title);
    setPages(await listUserLibraryPages(props.documentId));

    if (isUserLibraryImageMime(loadedMeta.mimeType)) {
      if (!reloadFile && imageUrl()) return;
      const blob = await getUserLibraryFile(props.documentId);
      if (!blob) {
        setLoadError('Файл личного документа недоступен.');
        return;
      }
      const previousUrl = imageUrl();
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      setImageUrl(URL.createObjectURL(blob));
      return;
    }

    if (!isUserLibraryPdfMime(loadedMeta.mimeType)) return;
    if (!reloadFile && activePdf) return;

    const blob = await getUserLibraryFile(props.documentId);
    if (!blob) {
      setLoadError('Файл личного документа недоступен.');
      return;
    }
    await replacePdf(blob);
  };

  onMount(() => {
    void refresh(true).catch((cause) => {
      setLoadError(cause instanceof Error ? cause.message : 'Не удалось открыть документ.');
    });
    const handleChange = (): void => {
      void refresh().catch((cause) => {
        setLoadError(cause instanceof Error ? cause.message : 'Не удалось обновить документ.');
      });
    };
    window.addEventListener(USER_LIBRARY_EVENT, handleChange);
    onCleanup(() => {
      pdfLoadGeneration += 1;
      window.removeEventListener(USER_LIBRARY_EVENT, handleChange);
      const url = imageUrl();
      if (url) URL.revokeObjectURL(url);
      const pdf = activePdf;
      activePdf = null;
      setPdfDocument(null);
      if (pdf) void pdf.destroy();
    });
  });

  createEffect(() => {
    if (!draftOpen() || !draftDirty()) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    onCleanup(() => window.removeEventListener('beforeunload', handleBeforeUnload));
  });

  const openDraftEditor = (): void => {
    setDraftError(null);
    setDraftText(draftSourceText());
    setDraftDirty(false);
    setLeaveAction(null);
    setPendingNavigation(null);
    setDraftOpen(true);
  };

  const persistDraft = async (): Promise<boolean> => {
    const current = meta();
    if (!current) return false;
    setDraftSaving(true);
    setDraftError(null);
    try {
      const saved = await saveUserLibraryDraft(current.id, draftText());
      if (!saved) throw new Error('Документ больше недоступен.');
      setLibraryDocument(saved);
      setPages(await listUserLibraryPages(current.id));
      props.onTitle?.(saved.title);
      setDraftDirty(false);
      toast.success('Черновик сохранён.');
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Не удалось сохранить черновик.';
      setDraftError(message);
      toast.error(message);
      return false;
    } finally {
      setDraftSaving(false);
    }
  };

  const askDiscard = (action: 'close' | 'navigate', href?: string): void => {
    setLeaveAction(action);
    setPendingNavigation(href ?? null);
    setDiscardOpen(true);
  };

  const closeDraftEditor = (): void => {
    if (draftDirty()) {
      askDiscard('close');
      return;
    }
    setDraftOpen(false);
    setLeaveAction(null);
    setPendingNavigation(null);
  };

  const discardDraft = (): void => {
    const action = leaveAction();
    const href = pendingNavigation();
    setDraftDirty(false);
    setDraftOpen(false);
    setDiscardOpen(false);
    setLeaveAction(null);
    setPendingNavigation(null);
    if (action === 'navigate' && href) navigateHref(props, href);
  };

  const saveDraft = async (): Promise<void> => {
    if (await persistDraft()) {
      setDraftOpen(false);
      setLeaveAction(null);
      setPendingNavigation(null);
    }
  };

  const saveDraftAndLeave = async (): Promise<void> => {
    if (!(await persistDraft())) return;
    const action = leaveAction();
    const href = pendingNavigation();
    setDraftOpen(false);
    setDiscardOpen(false);
    setLeaveAction(null);
    setPendingNavigation(null);
    if (action === 'navigate' && href) navigateHref(props, href);
  };

  const requestNavigate = (href: string): void => {
    if (draftOpen() && draftDirty()) {
      askDiscard('navigate', href);
      return;
    }
    navigateHref(props, href);
  };

  const openPresentationPreview = (slide: HTMLElement): void => {
    setPresentationPreviewSlide(slide);
  };

  const stayInDraft = (): void => {
    setDiscardOpen(false);
    setLeaveAction(null);
    setPendingNavigation(null);
  };

  createEffect(() => {
    const pageIndex = props.initialPageIndex;
    if (pageIndex === undefined) return;
    pages();
    markdownText();
    pdfPageCount();
    requestAnimationFrame(() => {
      const element = globalThis.document.getElementById(pageAnchorId(props.documentId, pageIndex));
      element?.scrollIntoView({ block: 'start' });
    });
  });

  const banner = (): string => {
    const current = meta();
    return current ? statusBanner(current) : '';
  };

  const printDocument = (): void => {
    const current = meta();
    if (!current) return;
    const capability = readerCapability();
    if (!hasReaderAction('print')) return;
    switch (capability.reader.renderer) {
      case 'markdown':
        void printRenderedMarkdown(markdownText(), current.title, isTemplateDocument()).then(
          (printed) => {
            if (!printed) toast.error('Не удалось открыть окно печати.');
          },
        );
        return;
      case 'sheet': {
        const rendered = document.querySelector<HTMLElement>('.rich-document-renderer.rich-sheet');
        if (!rendered) {
          toast.error('Документ ещё не готов к печати — попробуйте ещё раз через минуту.');
          return;
        }
        if (
          !PrintManager.element(rendered, current.title, {
            orientation: capability.reader.printOrientation,
          })
        ) {
          toast.error('Не удалось открыть окно печати.');
        }
        return;
      }
      case 'presentation': {
        const rendered = document.querySelector<HTMLElement>('.rich-document-renderer.rich-pptx');
        if (!rendered) {
          toast.error('Документ ещё не готов к печати — попробуйте ещё раз через минуту.');
          return;
        }
        if (!PrintManager.presentation(rendered, current.title))
          toast.error('Не удалось открыть окно печати.');
        return;
      }
      case 'docx': {
        const rendered = document.querySelector<HTMLElement>('.rich-document-renderer.rich-docx');
        if (!rendered) {
          toast.error('Документ ещё не готов к печати — попробуйте ещё раз через минуту.');
          return;
        }
        const printed = isTemplateDocument()
          ? PrintManager.element(rendered, current.title, { margin: '10mm' })
          : PrintManager.element(rendered, current.title);
        if (!printed) toast.error('Не удалось открыть окно печати.');
        return;
      }
      case 'epub':
        void PrintManager.epub(getUserLibraryFile(current.id), current.title).then((printed) => {
          if (!printed) toast.error('Не удалось открыть окно печати.');
        });
        return;
      case 'pdf':
        // Print the original PDF instead of our extracted text layer.
        void getUserLibraryFile(current.id)
          .then(async (blob) => {
            if (!blob) {
              toast.error('Не удалось открыть окно печати.');
              return;
            }
            if (!(await PrintManager.original(blob, current.title))) {
              toast.error('Не удалось открыть окно печати.');
            }
          })
          .catch(() => toast.error('Не удалось открыть окно печати.'));
        return;
      case 'image':
        void getUserLibraryFile(current.id)
          .then(async (blob) => {
            if (!blob) {
              toast.error('Не удалось открыть окно печати.');
              return;
            }
            const dataUrl = await readBlobAsDataUrl(blob);
            await new Promise<void>((resolve) => {
              const probe = new Image();
              probe.onload = () => resolve();
              probe.onerror = () => resolve();
              probe.src = dataUrl;
            });
            const printed = PrintManager.html(
              `<!doctype html><html lang="ru"><head><meta charset="utf-8" /><title>${escapePrintHtml(current.title)}</title><style>@page { size: A4 ${capability.reader.printOrientation}; }</style></head><body style="margin: 0"><img src="${dataUrl}" alt="${escapePrintHtml(current.title)}" style="max-width: 100%" /></body></html>`,
              current.title,
            );
            if (!printed) toast.error('Не удалось открыть окно печати.');
          })
          .catch(() => toast.error('Не удалось открыть окно печати.'));
        return;
      case 'text': {
        const html = buildUserDocumentPrintHtml(current.title, pages(), isTemplateDocument());
        if (!PrintManager.html(html, current.title)) toast.error('Не удалось открыть окно печати.');
        return;
      }
      case 'dicom':
      case 'volume':
      case 'download':
        return;
    }
  };

  const breadcrumbItems = createMemo(() => {
    const current = meta();
    if (origin) {
      return [
        { label: 'Заметки', href: '#/notes' },
        { label: origin.catalogLabel, href: origin.catalogHref },
        { label: current?.title ?? 'Шаблон' },
      ];
    }
    return [
      { label: 'Документы', href: '#/modules/documents' },
      { label: 'Ваши документы', href: USER_LIBRARY_CATALOG_HASH },
      { label: current?.title ?? 'Личный документ' },
    ];
  });

  const visualPageIndexes = createMemo(() => {
    const current = meta();
    if (!current || !isUserLibraryPdfMime(current.mimeType)) return [];
    return Array.from({ length: pdfPageCount() }, (_, index) => index);
  });

  const isPdf = (): boolean => {
    const current = meta();
    return current ? isUserLibraryPdfMime(current.mimeType) : false;
  };
  const pdfReady = createMemo(() => isPdf() && pdfDocument() !== null && pdfPageCount() > 0);
  createEffect(() => {
    markUserDocumentPdf(isPdf());
  });
  onCleanup(() => markUserDocumentPdf(false));
  const isImage = (): boolean => {
    const current = meta();
    return current ? isUserLibraryImageMime(current.mimeType) : false;
  };
  const richMime = (): string | undefined => {
    const current = meta();
    return current && isRichDocumentMime(current.mimeType) ? current.mimeType : undefined;
  };
  const isTextLike = (): boolean => {
    const renderer = readerCapability().reader.renderer;
    return renderer === 'markdown' || renderer === 'text';
  };
  const leaveMedicalViewer = (): void => {
    if (origin) {
      requestNavigate(origin.catalogHref);
      return;
    }
    navigateDocumentReaderBack(props.trail, props.onNavigate);
  };
  const showBannerProgress = (): boolean => {
    const current = meta();
    return current?.status === 'inspecting' || current?.status === 'ocr';
  };

  const toggleFullscreen = (): void => {
    setFullscreen((active) => {
      const next = !active;
      if (next) chrome.closeOutline();
      return next;
    });
  };

  const readerMenuActions = (): readonly AppContextMenuAction[] => {
    const actions: AppContextMenuAction[] = [];
    if (hasReaderAction('print')) {
      actions.push({
        id: 'print',
        label: 'Распечатать документ',
        icon: 'printer',
        disabled: draftOpen(),
        onSelect: printDocument,
      });
    }
    if (hasReaderAction('fullscreen')) {
      actions.push({
        id: 'fullscreen',
        label: fullscreen() ? 'Выйти из полноэкранного режима' : 'На весь экран',
        icon: fullscreen() ? 'arrows-in' : 'arrows-out',
        onSelect: toggleFullscreen,
      });
    }
    if (hasReaderAction('reading-mode')) {
      actions.push({
        id: 'reading-mode',
        label: 'Режим чтения',
        icon: bookReadingMode() ? 'check' : 'book-open',
        onSelect: readingMode.toggleBookMode,
      });
    }
    if (hasReaderAction('two-page')) {
      actions.push({
        id: 'two-page',
        label: readingMode.twoPageMode()
          ? 'Отключить разворот из двух страниц'
          : 'Разворот из двух страниц',
        icon: readingMode.twoPageMode() ? 'check' : 'squares-four',
        onSelect: () => setTwoPageMode(!readingMode.twoPageMode()),
      });
    }
    return actions;
  };

  const pageByIndex = (pageIndex: number): UserLibraryPage | undefined =>
    pages().find((item) => item.pageIndex === pageIndex);

  return (
    <>
      <DocumentReaderChromeShell
        ariaLabel={meta()?.title ?? 'Личный документ'}
        class="document-page user-document-reader page-surface page-grain"
        classList={{
          'document-page--book': bookReadingMode(),
          'user-document-reader--fullscreen': fullscreen(),
          'user-document-reader--medical': isMedicalImage(),
          'user-document-reader--sheet': isSheet(),
          'user-document-reader--sheet-fullscreen': isSheet() && fullscreen(),
        }}
        chromeClass="document-page__chrome sticky-surface route-sticky-chrome"
        chromeClassList={{
          'document-page__chrome--medical-hidden': isMedicalImage(),
          'document-page__chrome--sheet-fullscreen': isSheet() && fullscreen(),
        }}
        layoutClassList={{
          'document-overlay-layout--medical': isMedicalImage(),
          'document-overlay-layout--sheet-fullscreen': isSheet() && fullscreen(),
        }}
        bodyClassList={{
          'document-page__body--medical': isMedicalImage(),
          'document-page__body--sheet-fullscreen': isSheet() && fullscreen(),
        }}
        chrome={chrome}
        searchOpen={findOpen}
        trail={props.trail ?? null}
        onNavigate={requestNavigate}
        {...(origin ? { onBack: () => requestNavigate(origin.catalogHref) } : {})}
        breadcrumbs={
          <Show
            when={props.trail}
            fallback={<AppBreadcrumbs items={breadcrumbItems()} onNavigate={requestNavigate} />}
          >
            {(currentTrail) => (
              <DocumentCrumbs trail={currentTrail()} onNavigate={requestNavigate} />
            )}
          </Show>
        }
        headerSearchSlot={
          <Show when={!isMedicalImage() && readerCapability().reader.search !== 'none'}>
            <DocumentFindBar
              class="document-page__header-search"
              units={findUnits}
              disabled={!findSearchable()}
              onOpenChange={setFindOpen}
              onResult={setFindState}
            />
          </Show>
        }
        printButton={
          <Show when={meta() && readerMenuActions().length > 0}>
            <AppContextMenu
              class="document-reader-menu"
              buttonClass="document-reader-menu__button"
              buttonIcon="dots-three-vertical"
              buttonLabel="Действия документа"
              actions={readerMenuActions()}
            >
              <span class="document-reader-menu__anchor" aria-hidden="true" />
            </AppContextMenu>
          </Show>
        }
        onBackIntercept={() => {
          if (!fullscreen()) return false;
          setFullscreen(false);
          return true;
        }}
        bodyError={
          <Show when={loadError()}>
            {(message) => <p class="user-document-reader__error">{message()}</p>}
          </Show>
        }
        showLayout
        outlineEnabled={!isMedicalImage()}
        bodyPrefix={
          <Show when={banner()}>
            {(message) => (
              <div class="user-document-reader__banner" role="status">
                <p class="user-document-reader__banner-text">{message()}</p>
                <Show when={showBannerProgress()}>
                  <Show when={meta()}>
                    {(current) => (
                      <progress
                        class="user-document-reader__banner-progress"
                        max={1}
                        value={userLibraryProgressFraction(current())}
                      />
                    )}
                  </Show>
                </Show>
              </div>
            )}
          </Show>
        }
        outlineNav={
          <Show
            when={outlineItems().length > 0}
            fallback={
              <p class="document-overlay-outline-empty">
                {meta()?.status === 'inspecting'
                  ? 'Документ обрабатывается — оглавление появится после извлечения текста.'
                  : 'Нет разделов для отображения.'}
              </p>
            }
          >
            <For each={outlineItems()}>
              {(item) => (
                <button
                  type="button"
                  data-outline-anchor={item.anchor}
                  class="document-overlay-outline-item"
                  classList={{
                    'document-overlay-outline-item--depth-2': item.depth === 2,
                    'document-overlay-outline-item--depth-3': item.depth >= 3,
                    'document-overlay-outline-item--active': chrome.activeAnchor() === item.anchor,
                  }}
                  aria-current={chrome.activeAnchor() === item.anchor ? 'location' : undefined}
                  onClick={() => {
                    if (!isSheet()) {
                      chrome.scrollTo(item.anchor);
                      return;
                    }
                    setActiveSheetName(item.label);
                    requestAnimationFrame(() => chrome.scrollTo(item.anchor));
                  }}
                >
                  <span class="document-overlay-outline-item__label">{item.label}</span>
                </button>
              )}
            </For>
          </Show>
        }
        content={
          <article
            ref={chrome.setPaper}
            class="document-overlay-paper user-document-reader__paper"
            classList={{
              'user-document-reader__paper--medical': isMedicalImage(),
              'user-document-reader__paper--sheet-fullscreen': isSheet() && fullscreen(),
            }}
          >
            <Show when={meta()}>
              {(current) => (
                <Show when={!isMedicalImage()}>
                  <h1
                    class="document-overlay-paper__title"
                    classList={{
                      'document-overlay-paper__title--sheet-fullscreen': isSheet() && fullscreen(),
                    }}
                  >
                    <QueryHighlightedText
                      text={current().title}
                      query={findState().query}
                      exact={findState().mode === 'exact'}
                      fuzzy={findState().mode === 'similar'}
                      ranges={rangesForFindUnit(rangesByUnit(), current().id, findState().query)}
                      unitId={current().id}
                      activeStart={
                        activeMatch()?.unitId === current().id ? activeMatch()?.start : undefined
                      }
                      matchClass="document-overlay-match"
                    />
                  </h1>
                  <header
                    class="document-overlay-paper__header"
                    classList={{
                      'document-overlay-paper__header--sheet-fullscreen': isSheet() && fullscreen(),
                    }}
                  >
                    <div class="document-overlay-paper__actions">
                      <Show
                        when={draftOpen()}
                        fallback={
                          <Show when={editableSource()}>
                            <Button
                              type="button"
                              class="document-overlay-action-button"
                              onClick={openDraftEditor}
                              icon={
                                <AppGlyph
                                  name="edit"
                                  class="document-overlay-action-button__icon"
                                />
                              }
                            >
                              Редактировать
                            </Button>
                          </Show>
                        }
                      >
                        <span class="user-document-reader__draft-status" role="status">
                          Черновик{draftDirty() ? ' · не сохранён' : ''}
                        </span>
                        <Button
                          type="button"
                          class="document-overlay-action-button"
                          onClick={closeDraftEditor}
                          disabled={draftSaving()}
                        >
                          Отмена
                        </Button>
                        <Button
                          type="button"
                          variant="primary"
                          class="document-overlay-action-button"
                          onClick={() => void saveDraft()}
                          disabled={!draftDirty() || draftSaving()}
                          icon={
                            <AppGlyph
                              name={draftSaving() ? 'refresh' : 'check'}
                              class={
                                draftSaving()
                                  ? 'document-overlay-action-button__icon document-overlay-action-button__icon--spin'
                                  : 'document-overlay-action-button__icon'
                              }
                            />
                          }
                        >
                          {draftSaving() ? 'Сохраняем…' : 'Сохранить черновик'}
                        </Button>
                      </Show>
                    </div>
                  </header>
                </Show>
              )}
            </Show>

            <Show
              when={draftOpen()}
              fallback={
                <>
                  <Show when={isPdf()}>
                    <Show when={hasReaderAction('zoom') && pdfReady()}>
                      <div class="user-document-reader__pdf-zoom-controls">
                        <button
                          type="button"
                          class="user-document-reader__pdf-zoom-button"
                          aria-label="Уменьшить"
                          title="Уменьшить"
                          disabled={pdfZoom.scale() <= PINCH_ZOOM_MIN}
                          onClick={pdfZoom.zoomOut}
                        >
                          <AppGlyph name="minus" class="user-document-reader__pdf-zoom-icon" />
                        </button>
                        <button
                          type="button"
                          class="user-document-reader__pdf-zoom-value"
                          aria-label="Вернуть масштаб 100%"
                          title="Вернуть масштаб 100%"
                          disabled={pdfZoom.scale() <= PINCH_ZOOM_MIN}
                          onClick={() => pdfZoom.reset()}
                        >
                          {String(Math.round(pdfZoom.scale() * 100))}%
                        </button>
                        <button
                          type="button"
                          class="user-document-reader__pdf-zoom-button"
                          aria-label="Увеличить"
                          title="Увеличить"
                          disabled={pdfZoom.scale() >= PINCH_ZOOM_MAX}
                          onClick={pdfZoom.zoomIn}
                        >
                          <AppGlyph name="plus" class="user-document-reader__pdf-zoom-icon" />
                        </button>
                      </div>
                    </Show>
                    <PinchZoomSurface
                      pinch={pdfZoom}
                      expandScrollPort
                      class="pinch-zoom-surface user-document-reader__document-pinch user-document-reader__document-pinch--pdf"
                      contentClass="pinch-zoom-surface__content user-document-reader__document-pinch-content"
                    >
                      <div
                        class="user-document-reader__pages"
                        classList={{
                          'user-document-reader__pages--two': readingMode.twoPageMode(),
                        }}
                      >
                        <For each={visualPageIndexes()}>
                          {(pageIndex) => {
                            const page = (): UserLibraryPage | undefined => pageByIndex(pageIndex);
                            const words = (): readonly UserLibraryWordBox[] => page()?.words ?? [];
                            const anchor = () => pageAnchorId(props.documentId, pageIndex);
                            return (
                              <div
                                id={anchor()}
                                data-user-doc-anchor=""
                                class="user-document-reader__page"
                              >
                                <LazyPdfCanvas
                                  id={pageCanvasId(props.documentId, pageIndex)}
                                  pageNumber={pageIndex + 1}
                                  pdf={pdfDocument}
                                  class="user-document-reader__canvas"
                                  onError={(cause) => {
                                    setLoadError(
                                      cause instanceof Error
                                        ? cause.message
                                        : 'Не удалось отобразить страницу PDF.',
                                    );
                                  }}
                                />
                                <Show when={words().length > 0}>
                                  <WordOverlay
                                    pageAnchor={anchor()}
                                    words={words()}
                                    interactive={page()?.kind !== 'native'}
                                    hitUnitIds={hitUnitIds}
                                    activeUnitId={() => activeMatch()?.unitId}
                                  />
                                </Show>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    </PinchZoomSurface>
                  </Show>

                  <Show when={isImage()}>
                    <PinchZoomSurface
                      expandScrollPort
                      class="pinch-zoom-surface user-document-reader__document-pinch"
                      contentClass="pinch-zoom-surface__content user-document-reader__document-pinch-content"
                    >
                      <section
                        id={pageAnchorId(props.documentId, 0)}
                        data-user-doc-anchor=""
                        class="user-document-reader__page"
                      >
                        <Show when={imageUrl()}>
                          {(url) => (
                            <button
                              type="button"
                              class="user-document-reader__image-open"
                              aria-label="Открыть изображение крупно"
                              onClick={() => setImageLightboxOpen(true)}
                            >
                              <img
                                src={url()}
                                class="user-document-reader__image"
                                alt={meta()?.title ?? 'Изображение'}
                              />
                            </button>
                          )}
                        </Show>
                        <Show when={pageByIndex(0)?.words}>
                          {(wordBoxes) => (
                            <WordOverlay
                              pageAnchor={pageAnchorId(props.documentId, 0)}
                              words={wordBoxes()}
                              interactive
                              hitUnitIds={hitUnitIds}
                              activeUnitId={() => activeMatch()?.unitId}
                            />
                          )}
                        </Show>
                      </section>
                    </PinchZoomSurface>
                  </Show>

                  <Show when={isDicom() && meta()}>
                    {(current) => (
                      <DicomViewer
                        documentId={current().id}
                        title={current().title}
                        onBack={leaveMedicalViewer}
                      />
                    )}
                  </Show>

                  <Show when={isVolume() && meta()}>
                    {(current) => (
                      <VolumeViewer
                        documentId={current().id}
                        title={current().title}
                        onBack={leaveMedicalViewer}
                      />
                    )}
                  </Show>

                  <Show when={meta() && !isPdf() && !isImage() && !isMedicalImage()}>
                    <PinchZoomSurface
                      expandScrollPort
                      class="pinch-zoom-surface user-document-reader__document-pinch"
                      contentClass="pinch-zoom-surface__content user-document-reader__document-pinch-content"
                    >
                      <Show
                        when={
                          meta() &&
                          !isPdf() &&
                          !isImage() &&
                          !isMedicalImage() &&
                          !richMime() &&
                          !isTextLike()
                        }
                      >
                        <Show when={meta()} keyed>
                          {(current) => (
                            <section
                              class="user-document-reader__binary"
                              aria-label={current.title}
                            >
                              <AppGlyph name="archive" class="user-document-reader__binary-icon" />
                              <p class="user-document-reader__binary-name">{current.fileName}</p>
                              <p class="user-document-reader__binary-hint">
                                Этот тип файла нельзя открыть во встроенной читалке.
                              </p>
                              <Button
                                type="button"
                                variant="primary"
                                onClick={() => {
                                  void getUserLibraryFile(current.id).then((blob) => {
                                    if (!blob) return;
                                    const url = URL.createObjectURL(blob);
                                    const link = document.createElement('a');
                                    link.href = url;
                                    link.download = current.fileName || current.title;
                                    document.body.append(link);
                                    link.click();
                                    link.remove();
                                    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
                                  });
                                }}
                              >
                                Сохранить на устройство
                              </Button>
                            </section>
                          )}
                        </Show>
                      </Show>

                      <Show when={richMime()}>
                        {(mime) => (
                          <Show when={meta()} keyed>
                            {(current) => (
                              <RichDocumentRenderer
                                documentId={current.id}
                                fileName={current.fileName}
                                mimeType={mime()}
                                fullscreen={fullscreen()}
                                activeSheetName={activeSheetName()}
                                onSheetNamesChange={handleSheetNamesChange}
                                onActiveSheetChange={handleActiveSheetChange}
                                onExitFullscreen={() => setFullscreen(false)}
                                onPresentationSlideClick={openPresentationPreview}
                              />
                            )}
                          </Show>
                        )}
                      </Show>

                      <Show when={isTextLike() && meta()}>
                        {(current) => (
                          <UserDocumentHighlights
                            documentId={current().id}
                            surface={() =>
                              document.querySelector<HTMLElement>('.user-document-reader__paper') ??
                              undefined
                            }
                          />
                        )}
                      </Show>

                      <Show when={isTextLike()}>
                        <Show
                          when={isMarkdown()}
                          fallback={
                            <div class="user-document-reader__text-pages">
                              <For each={pages()}>
                                {(page) => {
                                  const anchor = () =>
                                    pageAnchorId(page.documentId, page.pageIndex);
                                  const state = () => findState();
                                  const activeStart = () =>
                                    activeMatch()?.unitId === anchor()
                                      ? activeMatch()?.start
                                      : undefined;
                                  return (
                                    <section
                                      id={anchor()}
                                      data-user-doc-anchor=""
                                      class="user-document-reader__text-section"
                                    >
                                      <pre class="user-document-reader__text">
                                        <QueryHighlightedText
                                          text={page.text}
                                          query={state().query}
                                          exact={state().mode === 'exact'}
                                          fuzzy={state().mode === 'similar'}
                                          ranges={rangesForFindUnit(
                                            rangesByUnit(),
                                            anchor(),
                                            state().query,
                                          )}
                                          unitId={anchor()}
                                          activeStart={activeStart()}
                                          matchClass="document-overlay-match"
                                        />
                                      </pre>
                                    </section>
                                  );
                                }}
                              </For>
                            </div>
                          }
                        >
                          <div class="user-document-reader__text-section" id={markdownAnchor()}>
                            <Show when={parsedMarkdown()} keyed>
                              {(parsed) => (
                                <SafeMarkdown markdown={markdownText()} parsed={parsed} />
                              )}
                            </Show>
                          </div>
                        </Show>
                      </Show>
                    </PinchZoomSurface>
                  </Show>
                </>
              }
            >
              <section
                class="user-document-reader__draft-editor"
                aria-label="Редактирование черновика"
              >
                <input
                  ref={(element) => {
                    draftFileInput = element;
                  }}
                  class="user-document-reader__draft-file-input"
                  type="file"
                  accept={userLibraryFileAccept()}
                  multiple
                  hidden
                  onChange={(event) => {
                    handleDraftFiles(event.currentTarget.files);
                    event.currentTarget.value = '';
                  }}
                />
                <Show
                  when={isMarkdown()}
                  fallback={
                    <Show
                      when={readerCapability().reader.renderer === 'docx'}
                      fallback={
                        <label class="user-document-reader__draft-field">
                          <span class="user-document-reader__draft-label">Текст черновика</span>
                          <textarea
                            class="user-document-reader__draft-input"
                            value={draftText()}
                            autofocus
                            aria-label="Текст черновика"
                            onInput={(event) => {
                              setDraftText(event.currentTarget.value);
                              setDraftDirty(true);
                              setDraftError(null);
                            }}
                          />
                        </label>
                      }
                    >
                      <PaginatedTextEditor
                        label="Текст черновика"
                        value={draftText()}
                        onChange={(value) => {
                          setDraftText(value);
                          setDraftDirty(true);
                          setDraftError(null);
                        }}
                      />
                    </Show>
                  }
                >
                  <NoteMarkdownEditor
                    label="Текст черновика"
                    printTitle={meta()?.title ?? ''}
                    templatePrint={isTemplateDocument()}
                    value={draftText()}
                    onChange={(value) => {
                      setDraftText(value);
                      setDraftDirty(true);
                      setDraftError(null);
                    }}
                    documents={[]}
                    onOpenFiles={openDraftFiles}
                    onRecordAudio={(file) =>
                      addUserLibraryFile(file, meta()?.folderId ?? null).then((saved) => saved.id)
                    }
                  />
                </Show>
                <p class="user-document-reader__draft-hint">{draftFormatHint()}</p>
                <Show when={draftError()}>
                  {(message) => (
                    <p class="user-document-reader__draft-error" role="alert">
                      {message()}
                    </p>
                  )}
                </Show>
              </section>
            </Show>
          </article>
        }
      />
      <MediaViewer
        open={presentationPreviewSlide() !== null}
        title={`${meta()?.title ?? 'Презентация'} — слайд крупно`}
        onClose={() => setPresentationPreviewSlide(null)}
      >
        <Show when={presentationPreviewSlide()} keyed>
          {(slide) => (
            <div class="user-document-reader__presentation-preview">
              <div
                class="user-document-reader__presentation-preview-content"
                ref={(element) => {
                  const clone = slide.cloneNode(true);
                  if (!(clone instanceof HTMLElement)) return;
                  clone.classList.add('user-document-reader__presentation-preview-slide');
                  clone.style.margin = '0 auto';
                  element.replaceChildren(clone);
                }}
              />
            </div>
          )}
        </Show>
      </MediaViewer>
      <OverlayDialog
        open={imageLightboxOpen()}
        title={meta()?.title ?? 'Изображение'}
        class="user-doc-image-lightbox"
        onClose={() => setImageLightboxOpen(false)}
      >
        <Show when={imageUrl()}>
          {(url) => (
            <img
              src={url()}
              class="user-doc-image-lightbox__image"
              alt={meta()?.title ?? 'Изображение'}
            />
          )}
        </Show>
      </OverlayDialog>
      <OverlayDialog
        open={discardOpen()}
        title="Несохранённый черновик"
        tracksHistory={false}
        onClose={stayInDraft}
      >
        <p class="user-document-reader__discard-copy">
          В черновике есть изменения. Сохранить их перед выходом?
        </p>
        <div class="user-document-reader__discard-actions">
          <Button type="button" onClick={stayInDraft}>
            Остаться
          </Button>
          <Button type="button" variant="danger" onClick={discardDraft}>
            Не сохранять
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={draftSaving()}
            onClick={() => void saveDraftAndLeave()}
          >
            {draftSaving() ? 'Сохраняем…' : 'Сохранить и выйти'}
          </Button>
        </div>
      </OverlayDialog>
    </>
  );
}

function markdownPrintStyles(templatePrint: boolean): string {
  return `
  body { font: 11pt/1.5 Georgia, 'Times New Roman', serif; color: #2b2b26; margin: 0; }
  h1, h2, h3, h4, h5, h6 { margin: 1.2em 0 0.4em; line-height: 1.2; break-after: avoid; }
  p { margin: 0.45em 0; text-indent: ${templatePrint ? '0' : '12.5mm'}; }
  ul, ol { margin: 0.45em 0; padding-left: 1.6em; }
  blockquote { margin: 0.7em 0; padding: 0.3em 0.9em; border-left: 3px solid #cbc0a7; color: #585349; }
  code { font-family: 'SFMono-Regular', Consolas, monospace; font-size: 0.88em; background: #f3efe2; padding: 0.1em 0.3em; border-radius: 3px; }
  pre { padding: 0.6em 0.8em; background: #f3efe2; border-radius: 4px; overflow: auto; }
  table { border-collapse: collapse; } th, td { border: 0.6pt solid #cbc0a7; padding: 3mm 2mm; }
  img { max-width: 100%; }
  figure { margin: 2mm 0 3mm; break-inside: avoid; }
  figcaption { font-size: 8pt; color: #585349; margin-top: 1mm; }
  hr { border: 0; border-top: 0.6pt solid #cbc0a7; margin: 4mm 0; }
`;
}

async function printRenderedMarkdown(
  markdown: string,
  title: string,
  templatePrint = false,
): Promise<boolean> {
  const [{ render }, { createComponent }] = await Promise.all([
    import('solid-js/web'),
    import('solid-js'),
  ]);
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.left = '-100vw';
  document.body.append(host);
  const dispose = render(() => createComponent(SafeMarkdown, { markdown }), host);
  const html = host.innerHTML;
  dispose();
  host.remove();
  if (!html.trim()) return false;
  return PrintManager.html(
    `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>${escapePrintHtml(title)}</title>
<style>@page { size: A4; margin: ${templatePrint ? '10mm' : '20mm 15mm 20mm 30mm'}; }${markdownPrintStyles(templatePrint)}</style>
</head>
<body>${html}</body>
</html>`,
    title,
  );
}
