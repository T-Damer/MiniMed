import type { MedicalDocumentSummary } from '@localmed/contracts';
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
import { Portal } from 'solid-js/web';
import { toast } from 'solid-sonner';

import { AppBreadcrumbs } from '@/components/AppBreadcrumbs';
import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { AudioWaveformPlayer } from '@/components/AudioWaveformPlayer';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { isAsrReady, transcribeBlob } from '@/features/asr/asr-models';
import { getAssessmentCatalog } from '@/features/assessments/assessment-catalog';
import { assessmentPath } from '@/features/assessments/assessment-routing';
import { getCalculatorRegistry } from '@/features/calculators/calculator-registry';
import type { AvailableCalculatorDefinition } from '@/features/calculators/calculator-types';
import { documentSectionHeadingTag } from '@/features/library/document-display';
import { printHtml } from '@/features/library/document-print';
import {
  DocumentReaderChromeShell,
  useDocumentReaderChrome,
} from '@/features/library/document-reader-chrome';
import { SafeMarkdown } from '@/features/library/SafeMarkdown';
import { escapePrintHtml } from '@/features/library/user-document-reader-helpers';
import { AttachmentViewerDialog, type ViewerState } from '@/features/notes/NoteAttachmentViewer';
import { NoteSearchToggle, NoteTextSearch } from '@/features/notes/NoteTextSearch';
import type { NoteWysiwyg } from '@/features/notes/note-wysiwyg';
import {
  createNoteWysiwyg,
  EMPTY_NOTE_MARKS,
  type NoteWysiwygMarks,
} from '@/features/notes/note-wysiwyg';
import { isNotesFullscreenRoute, withNotesFullscreen } from '@/features/notes/notes-routing';
import { VoiceRecordingButton } from '@/features/notes/VoiceRecordingButton';
import { openDocumentOverlay } from '@/state/document-navigation';
import { buildOfficialDocumentHash, parseDocumentReadRoute } from '@/state/document-route';
import { loadPatientNotes } from '@/state/patient-notes';
import '@/styles/note-markdown-editor.css';

export interface EditorFileAttachment {
  readonly key: string;
  readonly name: string;
  readonly kind: 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'download';
  readonly src?: string;
  readonly sizeBytes: number;
  readonly datesLabel: string;
  readonly viewer: ViewerState;
}

interface NoteMarkdownEditorProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly documents: readonly MedicalDocumentSummary[];
  readonly priorityDocumentIds?: readonly string[];
  readonly onOpenImages?: () => void;
  readonly onOpenFiles?: () => void;
  readonly fileAttachments?: readonly EditorFileAttachment[];
  readonly recordingOwnerId?: string;
  readonly onRecordAudio?: (
    file: File,
    ownerId: string,
  ) => string | undefined | Promise<string | undefined>;
  readonly onRemoveRecording?: (file: File, ownerId: string, persistedFileId?: string) => void;
  readonly onOpenReminders?: () => void;
  readonly disabled?: boolean;
}

const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

const MAX_MENTIONS = 5;

type MentionKind = 'document' | 'calculator' | 'assessment' | 'note';

const MENTION_KIND_LABEL: Record<MentionKind, string> = {
  document: 'Документ',
  calculator: 'Калькулятор',
  assessment: 'Тест',
  note: 'Заметка',
};

interface MentionSuggestion {
  readonly kind: MentionKind;
  readonly key: string;
  readonly title: string;
  readonly detail?: string;
  readonly markdown: string;
  readonly priority?: boolean;
}

type SlashCommandId = 'reminder' | 'voice' | 'attachment' | 'file';

interface SlashCommand {
  readonly id: SlashCommandId;
  readonly label: string;
  readonly hint: string;
  readonly aliases: readonly string[];
  readonly icon: AppGlyphName;
}

const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    id: 'reminder',
    label: 'Напоминание',
    hint: 'Добавить задачу или напоминание',
    aliases: ['reminder', 'задача', 'напомнить'],
    icon: 'clock',
  },
  {
    id: 'voice',
    label: 'Голос',
    hint: 'Записать голосовую заметку',
    aliases: ['voice', 'голос', 'аудио'],
    icon: 'microphone',
  },
  {
    id: 'attachment',
    label: 'Вложение',
    hint: 'Добавить изображение или вложение',
    aliases: ['attachment', 'вложение', 'изображение', 'картинка'],
    icon: 'file-plus',
  },
  {
    id: 'file',
    label: 'Файл',
    hint: 'Добавить файл из устройства',
    aliases: ['file', 'файл', 'документ'],
    icon: 'file-text',
  },
];

interface PendingRecording {
  readonly file: File;
  readonly url: string;
  readonly ownerId: string;
  readonly persistedFileId?: string;
}

const FILE_BLOCK_GLYPHS: Record<EditorFileAttachment['kind'], AppGlyphName> = {
  image: 'image',
  video: 'film-slate',
  audio: 'music-notes',
  pdf: 'file-text',
  text: 'file-text',
  download: 'file-plus',
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} МБ`;
}

interface TocEntry {
  readonly anchor: string;
  readonly label: string;
  readonly depth: number;
}

function sanitizeLinkLabel(value: string): string {
  return value.replaceAll('[', '').replaceAll(']', '').trim();
}

function normalizeRu(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
}

function noteTitle(text: string): string {
  const line = text
    .split('\n')
    .map((candidate) => candidate.replace(/^#+\s*|^[-*+]\s*|[*_`>]/gu, '').trim())
    .find(Boolean);
  return (line ?? '').slice(0, 60) || 'Заметка';
}

interface WysiwygFieldProps {
  readonly label: string;
  readonly initialValue: string;
  readonly latest: () => string;
  readonly disabled: boolean;
  readonly onChange: (markdown: string) => void;
  readonly onReady: (instance: NoteWysiwyg | null) => void;
  readonly onInput?: () => void;
  readonly onKeyDown?: (event: KeyboardEvent) => void;
}

function WysiwygField(props: WysiwygFieldProps): JSX.Element {
  let host!: HTMLDivElement;
  const instanceRef: { current: NoteWysiwyg | null } = { current: null };

  const handleKeyDown = (event: KeyboardEvent): void => {
    props.onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (instanceRef.current?.escapeQuoteOnEnter()) event.preventDefault();
  };

  const handleInput = (): void => props.onInput?.();

  const handleLinkClick = (event: MouseEvent): void => {
    const anchor = (event.target as HTMLElement | null)?.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href?.startsWith('#')) return;
    event.preventDefault();
    event.stopPropagation();
    const route = parseDocumentReadRoute(href);
    if (route && route.kind === 'official') {
      openDocumentOverlay(route.documentId, route.section ?? null);
      return;
    }
    window.location.hash = href;
  };

  onMount(() => {
    host.addEventListener('click', handleLinkClick);
    host.addEventListener('keydown', handleKeyDown, true);
    host.addEventListener('input', handleInput);
    onCleanup(() => {
      host.removeEventListener('click', handleLinkClick);
      host.removeEventListener('keydown', handleKeyDown, true);
      host.removeEventListener('input', handleInput);
    });
    let disposed = false;
    void createNoteWysiwyg({
      root: host,
      label: props.label,
      initialValue: props.initialValue,
      editable: () => !props.disabled,
      onChange: (markdown) => props.onChange(markdown),
    })
      .then((created) => {
        if (disposed) {
          created.destroy();
          return;
        }
        const freshest = props.latest();
        if (freshest !== props.initialValue) created.setMarkdown(freshest);
        instanceRef.current = created;
        props.onReady(created);
      })
      .catch((cause: unknown) => {
        if (disposed) return;
        toast.error(
          cause instanceof Error ? cause.message : 'Не удалось открыть редактор заметки.',
        );
      });
    onCleanup(() => {
      disposed = true;
      instanceRef.current?.destroy();
      props.onReady(null);
    });
  });

  return <div ref={host} class="note-markdown-wysiwyg" />;
}

export function NoteMarkdownEditor(props: NoteMarkdownEditorProps): JSX.Element {
  const [fullscreen, setFullscreenState] = createSignal(isNotesFullscreenRoute());
  const [mentionOpen, setMentionOpen] = createSignal(false);
  const [mentionQuery, setMentionQuery] = createSignal('');
  const [slashOpen, setSlashOpen] = createSignal(false);
  const [slashQuery, setSlashQuery] = createSignal('');
  const [slashActive, setSlashActive] = createSignal(0);
  const [toc, setToc] = createSignal<readonly TocEntry[]>([]);
  const [selectionMenu, setSelectionMenu] = createSignal<{ x: number; y: number } | null>(null);
  const [activeState, setActiveState] = createSignal({
    heading: false,
    strong: false,
    em: false,
    strike: false,
    highlight: false,
  });
  const [historyState, setHistoryState] = createSignal({ canUndo: false, canRedo: false });
  const [selectionMarks, setSelectionMarks] = createSignal<NoteWysiwygMarks>({
    ...EMPTY_NOTE_MARKS,
  });
  const [pendingRecordings, setPendingRecordings] = createSignal<readonly PendingRecording[]>([]);
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [deleteTarget, setDeleteTarget] = createSignal<PendingRecording | null>(null);
  const [asrPromptOpen, setAsrPromptOpen] = createSignal(false);
  const [transcribingKey, setTranscribingKey] = createSignal<string | null>(null);
  const [mentionActive, setMentionActive] = createSignal(0);
  const [fileViewer, setFileViewer] = createSignal<ViewerState | null>(null);

  let wysiwyg: NoteWysiwyg | null = null;
  let editorSurfaceRoot: HTMLElement | undefined;
  let lastEmitted = props.value;
  let tocRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  const [text, setText] = createSignal(props.value);
  const [recordingOwnerId, setRecordingOwnerId] = createSignal('');

  const setFullscreen = (enabled: boolean): void => {
    setFullscreenState(enabled);
    const currentHash = window.location.hash;
    const nextHash = withNotesFullscreen(currentHash, enabled);
    if (nextHash === currentHash) return;
    const currentHistoryState = window.history.state;
    const nextHistoryState =
      currentHistoryState && typeof currentHistoryState === 'object' ? currentHistoryState : {};
    window.history.replaceState({ ...nextHistoryState, noteFullscreen: enabled }, '', nextHash);
  };

  const chrome = useDocumentReaderChrome({
    sectionSelector:
      '.note-markdown-wysiwyg__surface h1, .note-markdown-wysiwyg__surface h2, .note-markdown-wysiwyg__surface h3, .note-markdown-wysiwyg__surface h4, .note-markdown-wysiwyg__surface h5, .note-markdown-wysiwyg__surface h6',
    outlineItemAttr: 'data-section-anchor',
    scrollSpyWhen: fullscreen,
  });

  const emit = (value: string): void => {
    lastEmitted = value;
    setText(value);
    props.onChange(value);
    scheduleTocRefresh();
  };

  createEffect(() => {
    const incoming = props.value;
    if (incoming === lastEmitted) return;
    lastEmitted = incoming;
    setText(incoming);
    if (wysiwyg && wysiwyg.getMarkdown() !== incoming) wysiwyg.setMarkdown(incoming);
    scheduleTocRefresh();
  });

  createEffect(() => {
    if (!fullscreen()) return;
    scheduleTocRefresh();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMentionOpen(false);
      setSlashOpen(false);
      setSlashQuery('');
      setSlashActive(0);
      setSelectionMenu(null);
      setFullscreen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  onMount(() => {
    const stateTimer = window.setInterval(() => {
      setActiveState(
        wysiwyg?.activeState() ?? {
          heading: false,
          strong: false,
          em: false,
          strike: false,
          highlight: false,
        },
      );
      setHistoryState(
        wysiwyg
          ? { canUndo: wysiwyg.canUndo(), canRedo: wysiwyg.canRedo() }
          : { canUndo: false, canRedo: false },
      );
      if (selectionMenu()) {
        setSelectionMarks(wysiwyg?.marksForRange() ?? { ...EMPTY_NOTE_MARKS });
      }
    }, 400);
    onCleanup(() => window.clearInterval(stateTimer));
    const refreshSelectionMenu = (): void => {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setSelectionMenu(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const surface = editorSurfaceRoot?.querySelector('.note-markdown-wysiwyg__surface');
      if (surface?.contains(range.commonAncestorContainer) !== true || props.disabled) {
        setSelectionMenu(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setSelectionMenu(null);
        return;
      }
      setSelectionMenu({ x: rect.left + rect.width / 2, y: rect.top });
    };
    document.addEventListener('selectionchange', refreshSelectionMenu);
    const dismissSelectionMenuOnScroll = (): void => {
      setSelectionMenu(null);
    };
    window.addEventListener('scroll', dismissSelectionMenuOnScroll, {
      capture: true,
      passive: true,
    });
    onCleanup(() => {
      document.removeEventListener('selectionchange', refreshSelectionMenu);
      window.removeEventListener('scroll', dismissSelectionMenuOnScroll, { capture: true });
    });
    scheduleTocRefresh();
  });

  onCleanup(() => {
    if (tocRefreshTimer !== undefined) clearTimeout(tocRefreshTimer);
  });

  const refreshToc = (attempt = 0): void => {
    const surface = editorSurfaceRoot?.querySelector<HTMLElement>(
      '.note-markdown-wysiwyg__surface',
    );
    if (!surface && attempt < 10) {
      setTimeout(() => refreshToc(attempt + 1), 120);
      return;
    }
    const headings = surface
      ? Array.from(surface.querySelectorAll<HTMLElement>(HEADING_TAGS.join(',')))
      : [];
    const usedIds = new Set<string>();
    setToc(
      headings.map((heading, index) => {
        let anchor = heading.id;
        if (!anchor || usedIds.has(anchor)) {
          anchor = `note-heading-${index + 1}`;
          heading.id = anchor;
        }
        usedIds.add(anchor);
        return {
          anchor,
          label: (heading.textContent ?? '').trim() || 'Без названия',
          depth: Number(heading.tagName.slice(1)) || 1,
        };
      }),
    );
  };

  const scheduleTocRefresh = (): void => {
    if (tocRefreshTimer !== undefined) clearTimeout(tocRefreshTimer);
    tocRefreshTimer = setTimeout(() => {
      tocRefreshTimer = undefined;
      refreshToc();
    }, 300);
  };

  const priorityIds = createMemo(() => new Set(props.priorityDocumentIds ?? []));
  const suggestions = createMemo<readonly MentionSuggestion[]>(() => {
    if (!mentionOpen()) return [];
    const needle = normalizeRu(mentionQuery().trim());
    const matches = (...fields: readonly string[]): boolean =>
      needle.length === 0 || fields.some((field) => normalizeRu(field).includes(needle));

    const documents = [...props.documents]
      .toSorted((left, right) => {
        const leftPriority = priorityIds().has(left.id);
        const rightPriority = priorityIds().has(right.id);
        if (leftPriority !== rightPriority) return leftPriority ? -1 : 1;
        return left.title.localeCompare(right.title, 'ru-RU');
      })
      .filter((document) => matches(document.title))
      .map(
        (document): MentionSuggestion => ({
          kind: 'document',
          key: `document:${document.id}`,
          title: document.title,
          priority: priorityIds().has(document.id),
          markdown: `[${sanitizeLinkLabel(document.title) || 'Документ'}](${buildOfficialDocumentHash(document.id)})`,
        }),
      );

    const calculators = getCalculatorRegistry()
      .filter(
        (calculator): calculator is AvailableCalculatorDefinition =>
          calculator.state === 'available',
      )
      .filter((calculator) =>
        matches(calculator.title, calculator.shortTitle, ...calculator.aliases),
      )
      .toSorted((left, right) => left.title.localeCompare(right.title, 'ru-RU'))
      .map(
        (calculator): MentionSuggestion => ({
          kind: 'calculator',
          key: `calculator:${calculator.id}`,
          title: calculator.title,
          markdown: `[${sanitizeLinkLabel(calculator.title)}](#/calculators/${encodeURIComponent(calculator.slug)})`,
        }),
      );

    const assessments = getAssessmentCatalog()
      .filter((entry) => matches(entry.title, entry.shortTitle, ...entry.aliases))
      .toSorted((left, right) => left.title.localeCompare(right.title, 'ru-RU'))
      .map(
        (entry): MentionSuggestion => ({
          kind: 'assessment',
          key: `assessment:${entry.id}`,
          title: entry.title,
          markdown: `[${sanitizeLinkLabel(entry.title)}](${assessmentPath(entry.bankId, entry.slug)})`,
        }),
      );

    const snapshot = loadPatientNotes();
    const cardsById = new Map(snapshot.cards.map((card) => [card.id, card.title]));
    const notes = snapshot.notes
      .filter((note) => matches(noteTitle(note.text), note.text))
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 20)
      .map((note): MentionSuggestion => {
        const title = noteTitle(note.text);
        const cardTitle = cardsById.get(note.cardId);
        return {
          kind: 'note',
          key: `note:${note.id}`,
          title,
          ...(cardTitle ? { detail: cardTitle } : {}),
          markdown: `[${sanitizeLinkLabel(title)}](#/notes/${encodeURIComponent(note.cardId)}/records/${encodeURIComponent(note.id)})`,
        };
      });

    const buckets = [documents, calculators, assessments, notes];
    const mixed: MentionSuggestion[] = [];
    for (let index = 0; mixed.length < MAX_MENTIONS; index += 1) {
      let added = false;
      for (const bucket of buckets) {
        const candidate = bucket[index];
        if (!candidate) continue;
        mixed.push(candidate);
        added = true;
        if (mixed.length >= MAX_MENTIONS) break;
      }
      if (!added) break;
    }
    return mixed;
  });

  const insertSuggestion = (suggestion: MentionSuggestion): void => {
    wysiwyg?.deleteBeforeCursor();
    wysiwyg?.insert(`${suggestion.markdown} `);
    setMentionOpen(false);
    setMentionQuery('');
    setMentionActive(0);
    wysiwyg?.focus();
  };

  const slashSuggestions = createMemo(() => {
    const needle = normalizeRu(slashQuery().trim());
    return SLASH_COMMANDS.filter(
      (command) =>
        needle.length === 0 ||
        [command.label, ...command.aliases].some((field) => normalizeRu(field).includes(needle)),
    );
  });

  const closeSlashMenu = (focus = true): void => {
    setSlashOpen(false);
    setSlashQuery('');
    setSlashActive(0);
    if (focus) wysiwyg?.focus();
  };

  const syncSlashMenu = (): void => {
    if (props.disabled) return;
    const match = /(?:^|\s)\/([\p{L}\p{N}_-]*)$/u.exec(wysiwyg?.textBeforeCursor() ?? '');
    if (!match) {
      if (slashOpen()) closeSlashMenu(false);
      return;
    }
    setSlashQuery(match[1] ?? '');
    setSlashOpen(true);
  };

  const moveSlashActive = (delta: number): void => {
    const total = slashSuggestions().length;
    if (total === 0) return;
    setSlashActive((current) => Math.min(total - 1, Math.max(0, current + delta)));
  };

  const activateSlashCommand = (command: SlashCommand): void => {
    wysiwyg?.deleteBeforeCursor('/');
    closeSlashMenu(false);
    if (command.id === 'reminder') {
      if (props.onOpenReminders) {
        props.onOpenReminders();
      } else {
        wysiwyg?.insert('- [ ] Напоминание: ');
        wysiwyg?.focus();
      }
      return;
    }
    if (command.id === 'voice') {
      const scope = editorSurfaceRoot?.closest<HTMLElement>('.note-markdown-editor');
      const voiceButton = scope?.querySelector<HTMLButtonElement>(
        '[data-note-voice-button="true"]',
      );
      if (voiceButton) {
        voiceButton.click();
        return;
      }
      toast.info('Голосовая запись недоступна в этом редакторе.');
      return;
    }
    const openFiles =
      command.id === 'attachment'
        ? (props.onOpenImages ?? props.onOpenFiles)
        : (props.onOpenFiles ?? props.onOpenImages);
    if (openFiles) {
      openFiles();
      return;
    }
    toast.info('Добавление файлов недоступно в этом редакторе.');
  };

  const handleEditorKeyDown = (event: KeyboardEvent): void => {
    if (!slashOpen()) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSlashActive(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSlashActive(-1);
      return;
    }
    if (event.key === 'Enter') {
      const command = slashSuggestions()[slashActive()];
      if (!command) return;
      event.preventDefault();
      activateSlashCommand(command);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSlashMenu();
    }
  };

  createEffect(() => {
    if (!slashOpen()) return;
    const total = slashSuggestions().length;
    setSlashActive((current) => Math.min(total - 1, Math.max(0, current)));
  });

  createEffect(() => {
    if (!mentionOpen()) return;
    suggestions();
    setMentionActive(0);
  });

  createEffect(() => {
    if (!mentionOpen()) return;
    const active = document.querySelector('.note-markdown-editor__mention--active');
    active?.scrollIntoView({ block: 'nearest' });
  });

  // Clicks outside the popup (and its toolbar trigger) dismiss it.
  createEffect(() => {
    if (!mentionOpen()) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.note-markdown-editor__mentions')) return;
      if (target.closest('.note-editor-mention-button')) return;
      setMentionOpen(false);
      setMentionQuery('');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    onCleanup(() => document.removeEventListener('pointerdown', onPointerDown, true));
  });

  createEffect(() => {
    if (!slashOpen()) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.note-markdown-editor__slash-menu')) return;
      if (target.closest('.note-markdown-wysiwyg__surface')) return;
      closeSlashMenu(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    onCleanup(() => document.removeEventListener('pointerdown', onPointerDown, true));
  });

  const openMentionMenu = (): void => {
    setMentionQuery('');
    setMentionActive(0);
    setMentionOpen(true);
  };

  const closeMentionMenu = (): void => {
    setMentionOpen(false);
    setMentionQuery('');
    setMentionActive(0);
    wysiwyg?.focus();
  };

  const moveMentionActive = (delta: number): void => {
    const total = suggestions().length;
    if (total === 0) return;
    setMentionActive((current) => Math.min(total - 1, Math.max(0, current + delta)));
  };

  const handleMentionSearchKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveMentionActive(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveMentionActive(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const suggestion = suggestions()[mentionActive()];
      if (suggestion) insertSuggestion(suggestion);
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeMentionMenu();
    }
  };

  /** Attachments shown inline under the text; fresh recordings are already bubbles. */
  const visibleFileAttachments = createMemo(() => {
    const attachments = props.fileAttachments ?? [];
    if (attachments.length === 0) return [];
    const pendingIds = new Set(
      pendingRecordings()
        .map((recording) => recording.persistedFileId)
        .filter((id): id is string => Boolean(id)),
    );
    return attachments.filter((file) => !pendingIds.has(file.key));
  });

  const handleRecordingComplete = (file: File): void => {
    const ownerId = recordingOwnerId();
    setRecordingOwnerId('');
    const recording: PendingRecording = { file, ownerId, url: URL.createObjectURL(file) };
    setPendingRecordings((current) => [...current, recording]);
    wysiwyg?.ensureTrailingParagraph();
    void Promise.resolve(props.onRecordAudio?.(file, ownerId))
      .then((persistedFileId) => {
        if (!persistedFileId) return;
        setPendingRecordings((current) =>
          current.map((item) => (item === recording ? { ...item, persistedFileId } : item)),
        );
      })
      .catch((cause: unknown) => {
        toast.error(cause instanceof Error ? cause.message : 'Не удалось сохранить запись.');
      });
  };

  const removeRecording = (recording: PendingRecording): void => {
    URL.revokeObjectURL(recording.url);
    setPendingRecordings((current) => current.filter((item) => item !== recording));
    props.onRemoveRecording?.(recording.file, recording.ownerId, recording.persistedFileId);
  };

  const handleTranscribe = async (recording: PendingRecording): Promise<void> => {
    if (!isAsrReady()) {
      setAsrPromptOpen(true);
      return;
    }
    setTranscribingKey(recording.url);
    try {
      const text = (await transcribeBlob(recording.file)).trim();
      if (!text) {
        toast.error('Речь не распознана.');
        return;
      }
      wysiwyg?.insert(`${text} `);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось расшифровать запись.');
    } finally {
      setTranscribingKey(null);
    }
  };

  onCleanup(() => {
    for (const recording of pendingRecordings()) URL.revokeObjectURL(recording.url);
  });

  const scrollToHeading = (index: number): void => {
    const entry = toc()[index];
    if (!entry) return;
    chrome.scrollTo(entry.anchor);
  };

  const handlePrint = (): void => {
    const surface = editorSurfaceRoot?.querySelector<HTMLElement>(
      '.note-markdown-wysiwyg__surface',
    );
    if (!surface) {
      toast.error('Не удалось открыть окно печати.');
      return;
    }
    const clone = surface.cloneNode(true) as HTMLElement;
    for (const node of Array.from(
      clone.querySelectorAll<HTMLElement>('[data-type="math_inline"], [data-type="math_block"]'),
    )) {
      node.textContent = `$${node.getAttribute('data-value') ?? ''}$`;
    }
    for (const node of Array.from(clone.querySelectorAll('.ProseMirror-trailingBreak')))
      node.remove();
    const printed = printHtml(
      [
        '<!doctype html><html lang="ru"><head><meta charset="utf-8">',
        `<title>${escapePrintHtml(props.label)}</title>`,
        '<style>',
        '@page { margin: 18mm; }',
        'body { margin: 0; color: #1f2422; background: #fff; font: 12pt/1.55 Georgia, "Times New Roman", serif; }',
        'article { max-width: 65ch; margin: 0 auto; }',
        'h1, h2, h3, h4, h5, h6 { margin: 1.2em 0 0.4em; line-height: 1.2; page-break-after: avoid; }',
        'h1 { font-size: 1.9em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }',
        'p { margin: 0.5em 0; } ul, ol { margin: 0.5em 0; padding-left: 1.6em; }',
        'blockquote { margin: 0.7em 0; padding: 0.3em 0.9em; border-left: 3px solid #999; color: #444; }',
        'pre { padding: 0.6em 0.8em; border: 1px solid #ddd; background: #f6f6f2; font-size: 0.85em; white-space: pre-wrap; }',
        'code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.88em; }',
        'table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #bbb; padding: 0.35em 0.5em; text-align: left; vertical-align: top; }',
        'img { max-width: 100%; } hr { border: 0; border-top: 1px solid #bbb; }',
        '</style></head><body>',
        `<h1>${escapePrintHtml(props.label)}</h1>`,
        clone.innerHTML,
        '</body></html>',
      ].join(''),
      props.label,
    );
    if (!printed) toast.error('Не удалось открыть окно печати.');
  };

  const formattingToolbar = (variant: 'embedded' | 'fullscreen'): JSX.Element => {
    const toolGroupClass =
      variant === 'fullscreen'
        ? 'note-markdown-editor__tool-group note-markdown-editor__tool-group--fullscreen'
        : 'note-markdown-editor__tool-group note-markdown-editor__tool-group--embedded';

    return (
      <div
        class="note-markdown-editor__toolbar"
        classList={{
          'note-markdown-editor__toolbar--embedded': variant === 'embedded',
          'note-markdown-editor__toolbar--fullscreen': variant === 'fullscreen',
        }}
        role="toolbar"
        aria-orientation={variant === 'fullscreen' ? 'horizontal' : 'vertical'}
        aria-label="Форматирование заметки"
      >
        <Show when={variant === 'embedded'}>
          <button
            class="note-markdown-editor__tool note-markdown-editor__tool--expand"
            type="button"
            aria-label="Развернуть редактор"
            title="На весь экран"
            onClick={() => setFullscreen(true)}
          >
            <AppGlyph name="arrows-out" class="note-markdown-editor__tool-icon" />
          </button>
        </Show>
        <fieldset class={toolGroupClass} aria-label="История изменений">
          <button
            class="note-markdown-editor__tool"
            type="button"
            aria-label="Отменить (Ctrl+Z)"
            title="Отменить"
            disabled={props.disabled || !historyState().canUndo}
            onClick={() => wysiwyg?.undo()}
          >
            <AppGlyph name="arrow-u-up-left" class="note-markdown-editor__tool-icon" />
          </button>
          <button
            class="note-markdown-editor__tool"
            type="button"
            aria-label="Вернуть (Ctrl+Shift+Z)"
            title="Вернуть"
            disabled={props.disabled || !historyState().canRedo}
            onClick={() => wysiwyg?.redo()}
          >
            <AppGlyph name="arrow-u-up-right" class="note-markdown-editor__tool-icon" />
          </button>
        </fieldset>
        <fieldset class={toolGroupClass} aria-label="Форматирование текста">
          <button
            class="note-markdown-editor__tool"
            classList={{ 'note-markdown-editor__tool--active': activeState().heading }}
            type="button"
            aria-label="Заголовок"
            title="Заголовок"
            disabled={props.disabled}
            onClick={() => wysiwyg?.toggleHeading(2)}
          >
            <AppGlyph name="text-h-two" class="note-markdown-editor__tool-icon" />
          </button>
          <button
            class="note-markdown-editor__tool"
            classList={{ 'note-markdown-editor__tool--active': activeState().strong }}
            type="button"
            aria-label="Жирный текст"
            title="Жирный текст"
            disabled={props.disabled}
            onClick={() => wysiwyg?.toggleBold()}
          >
            <AppGlyph name="text-b" class="note-markdown-editor__tool-icon" />
          </button>
          <button
            class="note-markdown-editor__tool"
            classList={{ 'note-markdown-editor__tool--active': activeState().em }}
            type="button"
            aria-label="Курсив"
            title="Курсив"
            disabled={props.disabled}
            onClick={() => wysiwyg?.toggleItalic()}
          >
            <AppGlyph name="text-italic" class="note-markdown-editor__tool-icon" />
          </button>
          <button
            class="note-markdown-editor__tool"
            classList={{ 'note-markdown-editor__tool--active': activeState().highlight }}
            type="button"
            aria-label="Выделить текст"
            title="Выделение"
            disabled={props.disabled}
            onClick={() => wysiwyg?.toggleHighlight()}
          >
            <AppGlyph name="highlighter" class="note-markdown-editor__tool-icon" />
          </button>
        </fieldset>
        <fieldset class={toolGroupClass} aria-label="Списки">
          <button
            class="note-markdown-editor__tool"
            type="button"
            aria-label="Маркированный список"
            title="Маркированный список"
            disabled={props.disabled}
            onClick={() => wysiwyg?.toggleBulletList()}
          >
            <AppGlyph name="list-bullets" class="note-markdown-editor__tool-icon" />
          </button>
          <button
            class="note-markdown-editor__tool"
            type="button"
            aria-label="Нумерованный список"
            title="Нумерованный список"
            disabled={props.disabled}
            onClick={() => wysiwyg?.toggleOrderedList()}
          >
            <AppGlyph name="list-numbers" class="note-markdown-editor__tool-icon" />
          </button>
        </fieldset>
        <fieldset class={toolGroupClass} aria-label="Вставка">
          <button
            class="note-markdown-editor__tool"
            type="button"
            aria-label="Формула LaTeX"
            title="LaTeX"
            disabled={props.disabled}
            onClick={() => wysiwyg?.insert('$x = y$')}
          >
            <AppGlyph name="math-operations" class="note-markdown-editor__tool-icon" />
          </button>
        </fieldset>
        <fieldset class={toolGroupClass} aria-label="Дополнительные действия">
          <Show when={props.onOpenReminders}>
            <button
              class="note-markdown-editor__tool"
              type="button"
              aria-label="Напоминание"
              title="Напоминание"
              disabled={props.disabled}
              onClick={() => props.onOpenReminders?.()}
            >
              <AppGlyph name="clock" class="note-markdown-editor__tool-icon" />
            </button>
          </Show>
          <Show when={props.onRecordAudio}>
            <VoiceRecordingButton
              disabled={Boolean(props.disabled)}
              onComplete={handleRecordingComplete}
              onStart={() => setRecordingOwnerId(props.recordingOwnerId ?? '')}
              onError={(message) => {
                setRecordingOwnerId('');
                toast.error(message);
              }}
            />
          </Show>
          <button
            class="note-markdown-editor__tool note-editor-mention-button"
            type="button"
            classList={{ 'note-markdown-editor__tool--active': mentionOpen() }}
            aria-label="Упомянуть документ"
            aria-expanded={mentionOpen()}
            title="Упоминание (@)"
            disabled={props.disabled}
            onClick={() => (mentionOpen() ? closeMentionMenu() : openMentionMenu())}
          >
            <AppGlyph name="at" class="note-markdown-editor__tool-icon" />
          </button>
          <Show when={props.onOpenImages}>
            <button
              class="note-markdown-editor__tool"
              type="button"
              aria-label="Добавить изображение"
              title="Изображения"
              disabled={props.disabled}
              onClick={() => props.onOpenImages?.()}
            >
              <AppGlyph name="file-plus" class="note-markdown-editor__tool-icon" />
            </button>
          </Show>
          <Show when={props.onOpenFiles && !props.onOpenImages}>
            <button
              class="note-markdown-editor__tool"
              type="button"
              aria-label="Добавить файл"
              title="Файл"
              disabled={props.disabled}
              onClick={() => props.onOpenFiles?.()}
            >
              <AppGlyph name="file-text" class="note-markdown-editor__tool-icon" />
            </button>
          </Show>
        </fieldset>
      </div>
    );
  };

  const mentionPopup = (): JSX.Element => (
    <Show when={mentionOpen()}>
      <div class="note-markdown-editor__mentions" role="listbox" aria-label="Упоминания">
        <div class="note-markdown-editor__mentions-head">
          <input
            class="note-markdown-editor__mentions-search"
            type="text"
            placeholder="Поиск документа, калькулятора, теста, заметки"
            aria-label="Поиск того, что нужно вставить в заметку"
            aria-activedescendant={`mention-option-${mentionActive()}`}
            value={mentionQuery()}
            ref={(element) => {
              queueMicrotask(() => {
                element.focus();
                element.select();
              });
            }}
            onInput={(event) => setMentionQuery(event.currentTarget.value)}
            onKeyDown={handleMentionSearchKeyDown}
          />
          <button
            type="button"
            class="note-markdown-editor__mentions-close"
            aria-label="Закрыть меню упоминаний"
            title="Закрыть"
            onMouseDown={(event) => event.preventDefault()}
            onClick={closeMentionMenu}
          >
            <AppGlyph name="close" class="note-markdown-editor__mentions-close-icon" />
          </button>
        </div>
        <For each={suggestions()}>
          {(suggestion, index) => (
            <button
              class="note-markdown-editor__mention"
              classList={{
                'note-markdown-editor__mention--active': mentionActive() === index(),
              }}
              id={`mention-option-${index()}`}
              type="button"
              role="option"
              aria-selected={mentionActive() === index()}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setMentionActive(index())}
              onClick={() => insertSuggestion(suggestion)}
            >
              <span class="note-markdown-editor__mention-title">
                {suggestion.detail
                  ? `${suggestion.title} · ${suggestion.detail}`
                  : suggestion.title}
              </span>
              <Show
                when={suggestion.priority}
                fallback={
                  <small class="note-markdown-editor__mention-kind">
                    {MENTION_KIND_LABEL[suggestion.kind]}
                  </small>
                }
              >
                <small class="note-markdown-editor__mention-priority">из заметки</small>
              </Show>
            </button>
          )}
        </For>
        <Show when={suggestions().length === 0}>
          <p class="note-markdown-editor__mentions-empty">Ничего не найдено.</p>
        </Show>
      </div>
    </Show>
  );

  const slashPopup = (): JSX.Element => (
    <Show when={slashOpen()}>
      <div class="note-markdown-editor__slash-menu" role="listbox" aria-label="Команды вставки">
        <div class="note-markdown-editor__slash-head">
          <strong class="note-markdown-editor__slash-title">Добавить</strong>
          <kbd class="note-markdown-editor__slash-key">/</kbd>
        </div>
        <For each={slashSuggestions()}>
          {(command, index) => (
            <button
              id={`slash-option-${index()}`}
              class="note-markdown-editor__slash-command"
              classList={{
                'note-markdown-editor__slash-command--active': slashActive() === index(),
              }}
              type="button"
              role="option"
              aria-selected={slashActive() === index()}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setSlashActive(index())}
              onClick={() => activateSlashCommand(command)}
            >
              <span class="note-markdown-editor__slash-icon" aria-hidden="true">
                <AppGlyph name={command.icon} class="note-markdown-editor__slash-icon-glyph" />
              </span>
              <span class="note-markdown-editor__slash-copy">
                <strong class="note-markdown-editor__slash-label">{command.label}</strong>
                <small class="note-markdown-editor__slash-hint">{command.hint}</small>
              </span>
            </button>
          )}
        </For>
        <Show when={slashSuggestions().length === 0}>
          <p class="note-markdown-editor__slash-empty">Команда не найдена.</p>
        </Show>
      </div>
    </Show>
  );

  const wysiwygEditor = (variant: 'embedded' | 'fullscreen'): JSX.Element => (
    <div
      ref={(element) => {
        editorSurfaceRoot = element;
      }}
      class={`note-markdown-editor__wysiwyg-host note-markdown-editor__wysiwyg-host--${variant}`}
      classList={{ 'note-markdown-editor__wysiwyg-host--slash-open': slashOpen() }}
    >
      <Show
        when={!props.disabled}
        fallback={<SafeMarkdown class="note-markdown-editor__readonly-preview" markdown={text()} />}
      >
        <WysiwygField
          label={props.label}
          initialValue={text()}
          latest={() => text()}
          disabled={Boolean(props.disabled)}
          onChange={(markdown) => {
            emit(markdown);
            syncSlashMenu();
          }}
          onInput={syncSlashMenu}
          onKeyDown={handleEditorKeyDown}
          onReady={(instance) => {
            wysiwyg = instance;
            scheduleTocRefresh();
          }}
        />
      </Show>
      {slashPopup()}
      {mentionPopup()}
      <Show when={pendingRecordings().length > 0}>
        <div class="note-voice-bubbles">
          <For each={pendingRecordings()}>
            {(recording) => (
              <div class="note-voice-bubble">
                <AudioWaveformPlayer src={recording.url} label={recording.file.name} compact />
                <button
                  type="button"
                  class="note-voice-bubble__transcribe"
                  aria-label={`Расшифровать запись «${recording.file.name}»`}
                  title="Расшифровать речь"
                  disabled={transcribingKey() === recording.url}
                  onClick={() => void handleTranscribe(recording)}
                >
                  <AppGlyph name="text-aa" class="note-voice-bubble__transcribe-icon" />
                </button>
                <button
                  type="button"
                  class="note-voice-bubble__remove"
                  aria-label={`Удалить запись «${recording.file.name}»`}
                  title="Удалить запись"
                  onClick={() => setDeleteTarget(recording)}
                >
                  <AppGlyph name="trash" class="note-voice-bubble__remove-icon" />
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={visibleFileAttachments().length > 0}>
        <div class="note-file-blocks">
          <For each={visibleFileAttachments()}>
            {(file) => (
              <button
                type="button"
                class="note-file-block paper-card"
                aria-label={`Открыть «${file.name}»`}
                title={file.name}
                onClick={() => setFileViewer(file.viewer)}
              >
                <span
                  class={`note-file-block__thumb note-file-kind--${file.kind}`}
                  aria-hidden="true"
                >
                  <Show
                    when={file.kind === 'image' && file.src}
                    fallback={
                      <AppGlyph
                        name={FILE_BLOCK_GLYPHS[file.kind]}
                        class="note-file-block__glyph"
                      />
                    }
                  >
                    {(src) => (
                      <img class="note-file-block__image" src={src()} alt="" loading="lazy" />
                    )}
                  </Show>
                </span>
                <span class="note-file-block__info">
                  <strong class="note-file-block__name">{file.name}</strong>
                  <small class="note-file-block__meta">{file.datesLabel}</small>
                  <small class="note-file-block__meta">{formatFileSize(file.sizeBytes)}</small>
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>
      <AttachmentViewerDialog state={fileViewer()} onClose={() => setFileViewer(null)} />
      <ConfirmationDialog
        open={Boolean(deleteTarget())}
        title="Удалить запись?"
        description={`«${deleteTarget()?.file.name ?? ''}» будет удалена безвозвратно.`}
        confirmLabel="Удалить"
        danger
        onConfirm={() => {
          const target = deleteTarget();
          setDeleteTarget(null);
          if (target) removeRecording(target);
        }}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      />
      <ConfirmationDialog
        open={asrPromptOpen()}
        title="Нужна модель расшифровки"
        description="Скачайте модель распознавания речи в настройках, чтобы расшифровывать голосовые записи на устройстве."
        confirmLabel="Перейти в настройки"
        onConfirm={() => {
          setAsrPromptOpen(false);
          window.location.hash = '#/settings';
        }}
        onOpenChange={setAsrPromptOpen}
      />
    </div>
  );

  const embeddedEditor = (): JSX.Element => (
    <section class="note-markdown-editor">
      <div class="note-markdown-editor__workspace">
        {wysiwygEditor('embedded')}
        {formattingToolbar('embedded')}
      </div>
    </section>
  );

  const fullscreenEditor = (): JSX.Element => (
    <DocumentReaderChromeShell
      class="note-markdown-editor note-markdown-editor--fullscreen document-page page-surface page-grain"
      ariaLabel="Полноэкранный редактор заметки"
      chrome={chrome}
      searchOpen={searchOpen}
      chromeClassList={{ 'note-markdown-editor__chrome': true }}
      onBack={() => setFullscreen(false)}
      onBackIntercept={() => {
        if (!searchOpen()) return false;
        setSearchOpen(false);
        return true;
      }}
      breadcrumbs={<AppBreadcrumbs items={[{ label: props.label }]} />}
      headerSearchSlot={
        <div class="note-markdown-editor__header-actions">
          <Show
            when={searchOpen()}
            fallback={<NoteSearchToggle onToggle={() => setSearchOpen(true)} />}
          >
            <NoteTextSearch
              surface={() =>
                editorSurfaceRoot?.querySelector<HTMLElement>('.note-markdown-wysiwyg__surface') ??
                undefined
              }
              onClose={() => setSearchOpen(false)}
            />
          </Show>
          <Show when={!searchOpen()}>
            <button
              type="button"
              class="note-markdown-editor__print-button"
              aria-label="Распечатать заметку"
              title="Печать"
              onClick={handlePrint}
            >
              <AppGlyph name="printer" class="note-markdown-editor__print-icon" />
            </button>
          </Show>
        </div>
      }
      bodyPrefix={
        <div class="note-markdown-editor__chrome-tools">{formattingToolbar('fullscreen')}</div>
      }
      showLayout
      outlineNav={
        <Show
          when={toc().length > 0}
          fallback={
            <p class="document-overlay-outline-empty">
              Добавьте заголовок — он появится в оглавлении.
            </p>
          }
        >
          <For each={toc()}>
            {(item, index) => {
              const headingTag = documentSectionHeadingTag(item.depth - 1);
              return (
                <button
                  type="button"
                  data-section-anchor={item.anchor}
                  class={`document-overlay-outline-section-button document-overlay-outline-section-button--${headingTag}`}
                  classList={{
                    'document-overlay-outline-section-button--active':
                      chrome.activeAnchor() === item.anchor,
                  }}
                  aria-current={chrome.activeAnchor() === item.anchor ? 'location' : undefined}
                  onClick={() => scrollToHeading(index())}
                >
                  <span class="document-overlay-outline-section-number">
                    {String(index() + 1).padStart(2, '0')}
                  </span>
                  <span class="document-overlay-outline-section-button__label">{item.label}</span>
                </button>
              );
            }}
          </For>
        </Show>
      }
      content={
        <article ref={chrome.setPaper} class="document-overlay-paper">
          <h1 class="document-overlay-paper__title">{props.label}</h1>
          <div class="note-markdown-editor__fullscreen-content">{wysiwygEditor('fullscreen')}</div>
        </article>
      }
    />
  );

  return (
    <>
      <Show when={fullscreen()} fallback={embeddedEditor()}>
        <Portal>{fullscreenEditor()}</Portal>
      </Show>
      <Show when={selectionMenu()}>
        {(position) => (
          <Portal>
            <div
              class="note-selection-menu"
              role="toolbar"
              aria-label="Форматирование выделенного текста"
              style={{ left: `${position().x}px`, top: `${position().y}px` }}
            >
              <button
                type="button"
                class="note-selection-menu__button"
                classList={{ 'note-selection-menu__button--active': selectionMarks().strong }}
                aria-label="Жирный текст"
                title="Жирный текст"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  wysiwyg?.toggleBold();
                  setSelectionMarks(wysiwyg?.marksForRange() ?? { ...EMPTY_NOTE_MARKS });
                }}
              >
                B
              </button>
              <button
                type="button"
                class="note-selection-menu__button note-selection-menu__button--italic"
                classList={{ 'note-selection-menu__button--active': selectionMarks().em }}
                aria-label="Курсив"
                title="Курсив"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  wysiwyg?.toggleItalic();
                  setSelectionMarks(wysiwyg?.marksForRange() ?? { ...EMPTY_NOTE_MARKS });
                }}
              >
                I
              </button>
              <button
                type="button"
                class="note-selection-menu__button"
                classList={{ 'note-selection-menu__button--active': selectionMarks().highlight }}
                aria-label="Выделить цветом"
                title="Выделение"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  wysiwyg?.toggleHighlight();
                  setSelectionMarks(wysiwyg?.marksForRange() ?? { ...EMPTY_NOTE_MARKS });
                }}
              >
                <AppGlyph name="highlighter" class="note-selection-menu__icon" />
              </button>
              <button
                type="button"
                class="note-selection-menu__button note-selection-menu__button--strike"
                classList={{ 'note-selection-menu__button--active': selectionMarks().strike }}
                aria-label="Зачёркнутый текст"
                title="Зачёркнутый"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  wysiwyg?.toggleStrikethrough();
                  setSelectionMarks(wysiwyg?.marksForRange() ?? { ...EMPTY_NOTE_MARKS });
                }}
              >
                S
              </button>
            </div>
          </Portal>
        )}
      </Show>
    </>
  );
}
