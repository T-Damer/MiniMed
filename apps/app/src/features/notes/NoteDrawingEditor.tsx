import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFiles, ExcalidrawProps } from '@excalidraw/excalidraw/types';
import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { OverlayDialog } from '@/components/OverlayDialog';
import {
  createEmptyDrawing,
  type DrawingDocument,
  parseDrawingBlob,
  parseDrawingDocument,
} from '@/features/notes/note-drawing';
import '@/styles/note-drawing.css';

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

type ExcalidrawModule = typeof import('@excalidraw/excalidraw');
type ExcalidrawRuntime = Pick<ExcalidrawModule, 'serializeAsJSON' | 'exportToSvg'>;
type ReactRoot = import('react-dom/client').Root;

interface DrawingScene {
  readonly elements: readonly ExcalidrawElement[];
  readonly appState: Partial<AppState>;
  readonly files: BinaryFiles;
}

interface LazyExcalidrawProps {
  readonly initial: DrawingDocument;
  readonly onSceneChange: (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => void;
  readonly onRuntime: (runtime: ExcalidrawRuntime) => void;
}

function LazyExcalidraw(props: LazyExcalidrawProps): JSX.Element {
  let host!: HTMLDivElement;
  let root: ReactRoot | undefined;
  const [status, setStatus] = createSignal<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = createSignal('');

  onMount(() => {
    let disposed = false;

    const load = async (): Promise<void> => {
      window.EXCALIDRAW_ASSET_PATH = new URL('./excalidraw/', document.baseURI).toString();
      const [react, reactDom, excalidraw] = await Promise.all([
        import('react'),
        import('react-dom/client'),
        import('@excalidraw/excalidraw'),
        import('@excalidraw/excalidraw/index.css'),
      ]).then(
        ([reactModule, reactDomModule, excalidrawModule]) =>
          [reactModule, reactDomModule, excalidrawModule] as const,
      );
      if (disposed) return;

      root = reactDom.createRoot(host);
      props.onRuntime({
        serializeAsJSON: excalidraw.serializeAsJSON,
        exportToSvg: excalidraw.exportToSvg,
      });
      const editorProps: ExcalidrawProps = {
        initialData: props.initial,
        langCode: 'ru-RU',
        autoFocus: true,
        handleKeyboardGlobally: false,
        onChange: props.onSceneChange,
        validateEmbeddable: () => false,
        UIOptions: {
          canvasActions: {
            changeViewBackgroundColor: true,
            clearCanvas: true,
            export: false,
            loadScene: false,
            saveToActiveFile: false,
            toggleTheme: true,
            saveAsImage: false,
          },
          tools: { image: true },
        },
      };
      root.render(react.createElement(excalidraw.Excalidraw, editorProps));
      if (disposed) {
        root.unmount();
        root = undefined;
        return;
      }
      setStatus('ready');
    };

    void load().catch((cause: unknown) => {
      if (disposed) return;
      setErrorMessage(cause instanceof Error ? cause.message : 'Не удалось загрузить редактор.');
      setStatus('error');
    });

    onCleanup(() => {
      disposed = true;
      root?.unmount();
      root = undefined;
    });
  });

  return (
    <div class="note-drawing-editor__canvas-shell">
      <div class="note-drawing-editor__canvas" ref={host} />
      <Show when={status() === 'loading'}>
        <div class="note-drawing-editor__canvas-status" role="status">
          Загрузка редактора схем…
        </div>
      </Show>
      <Show when={status() === 'error'}>
        <div class="note-drawing-editor__canvas-status note-drawing-editor__canvas-status--error">
          Не удалось загрузить редактор схем: {errorMessage()}
        </div>
      </Show>
    </div>
  );
}

interface PreviewBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const PREVIEW_FALLBACK_BOUNDS: PreviewBounds = {
  x: 0,
  y: 0,
  width: 960,
  height: 640,
};

const PREVIEW_COLOR_PATTERN = /^(?:transparent|#[0-9a-f]{3,4}|#[0-9a-f]{6}(?:[0-9a-f]{2})?)$/iu;

function previewColor(value: string, fallback: string): string {
  return PREVIEW_COLOR_PATTERN.test(value) ? value : fallback;
}

function previewOpacity(value: number): number {
  return Math.max(0, Math.min(100, value)) / 100;
}

function elementBounds(element: ExcalidrawElement): PreviewBounds {
  let minX = element.x;
  let minY = element.y;
  let maxX = element.x + element.width;
  let maxY = element.y + element.height;

  if (element.type === 'line' || element.type === 'arrow' || element.type === 'freedraw') {
    for (const [x, y] of element.points) {
      minX = Math.min(minX, element.x + x);
      minY = Math.min(minY, element.y + y);
      maxX = Math.max(maxX, element.x + x);
      maxY = Math.max(maxY, element.y + y);
    }
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function previewBounds(document: DrawingDocument): PreviewBounds {
  const visible = document.elements.filter((element) => !element.isDeleted);
  if (visible.length === 0) return PREVIEW_FALLBACK_BOUNDS;
  const bounds = visible.map(elementBounds);
  const minX = Math.min(...bounds.map((item) => item.x));
  const minY = Math.min(...bounds.map((item) => item.y));
  const maxX = Math.max(...bounds.map((item) => item.x + item.width));
  const maxY = Math.max(...bounds.map((item) => item.y + item.height));
  const padding = 32;
  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(320, maxX - minX + padding * 2),
    height: Math.max(220, maxY - minY + padding * 2),
  };
}

function rotationTransform(element: ExcalidrawElement): string | undefined {
  if (element.angle === 0) return undefined;
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  return `rotate(${(element.angle * 180) / Math.PI} ${centerX} ${centerY})`;
}

function localPoints(
  element: Extract<ExcalidrawElement, { type: 'line' | 'arrow' | 'freedraw' }>,
): string {
  return element.points.map(([x, y]) => `${element.x + x},${element.y + y}`).join(' ');
}

function previewElement(
  element: ExcalidrawElement,
  index: number,
  markerPrefix: string,
): JSX.Element {
  const stroke = previewColor(element.strokeColor, '#244b49');
  const background = previewColor(element.backgroundColor, 'transparent');
  const fill = background === 'transparent' ? 'none' : background;
  const opacity = previewOpacity(element.opacity);
  const transform = rotationTransform(element);

  if (element.type === 'text') {
    return (
      <text
        class="note-drawing-preview__text"
        x={element.x}
        y={element.y}
        fill={stroke}
        opacity={opacity}
        font-size={String(element.fontSize)}
        transform={transform}
        dominant-baseline="hanging"
      >
        {element.text}
      </text>
    );
  }

  if (element.type === 'line' || element.type === 'arrow' || element.type === 'freedraw') {
    return (
      <polyline
        class="note-drawing-preview__line"
        points={localPoints(element)}
        fill="none"
        stroke={stroke}
        stroke-width={Math.max(1, element.strokeWidth)}
        stroke-linecap="round"
        stroke-linejoin="round"
        opacity={opacity}
        transform={transform}
        marker-end={element.type === 'arrow' ? `url(#${markerPrefix}-${index})` : undefined}
      />
    );
  }

  if (element.type === 'rectangle' || element.type === 'frame' || element.type === 'magicframe') {
    return (
      <rect
        class="note-drawing-preview__shape"
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        fill={element.type === 'rectangle' ? fill : 'none'}
        stroke={stroke}
        stroke-width={Math.max(1, element.strokeWidth)}
        stroke-dasharray={element.type === 'rectangle' ? undefined : '8 5'}
        opacity={opacity}
        transform={transform}
      />
    );
  }

  if (element.type === 'diamond') {
    const points = `${element.x + element.width / 2},${element.y} ${element.x + element.width},${element.y + element.height / 2} ${element.x + element.width / 2},${element.y + element.height} ${element.x},${element.y + element.height / 2}`;
    return (
      <polygon
        class="note-drawing-preview__shape"
        points={points}
        fill={fill}
        stroke={stroke}
        stroke-width={Math.max(1, element.strokeWidth)}
        opacity={opacity}
        transform={transform}
      />
    );
  }

  if (element.type === 'ellipse') {
    return (
      <ellipse
        class="note-drawing-preview__shape"
        cx={element.x + element.width / 2}
        cy={element.y + element.height / 2}
        rx={element.width / 2}
        ry={element.height / 2}
        fill={fill}
        stroke={stroke}
        stroke-width={Math.max(1, element.strokeWidth)}
        opacity={opacity}
        transform={transform}
      />
    );
  }

  if (element.type === 'image') {
    return (
      <g class="note-drawing-preview__image-placeholder" opacity={opacity} transform={transform}>
        <rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          fill="none"
          stroke={stroke}
          stroke-width="1"
          stroke-dasharray="5 4"
        />
        <text
          x={element.x + element.width / 2}
          y={element.y + element.height / 2}
          fill={stroke}
          font-size="12"
          text-anchor="middle"
          dominant-baseline="middle"
        >
          Изображение
        </text>
      </g>
    );
  }

  return <g />;
}

function DrawingPreviewSvg(props: {
  readonly document: DrawingDocument;
  readonly label: string;
}): JSX.Element {
  const bounds = previewBounds(props.document);
  const markerPrefix = `note-drawing-preview-arrow-${Math.random().toString(36).slice(2)}`;
  const arrows = props.document.elements.filter(
    (element) => element.type === 'arrow' && !element.isDeleted,
  );
  const background = previewColor(
    props.document.appState?.viewBackgroundColor ?? '#fffdf8',
    '#fffdf8',
  );

  return (
    <svg
      class="note-drawing-preview__svg"
      viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
      role="img"
      aria-label={props.label}
    >
      <title>{props.label}</title>
      <defs>
        <For each={arrows}>
          {(element) => (
            <marker
              class="note-drawing-preview__arrowhead"
              id={`${markerPrefix}-${props.document.elements.indexOf(element)}`}
              markerWidth="10"
              markerHeight="10"
              refX="8"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" fill={previewColor(element.strokeColor, '#244b49')} />
            </marker>
          )}
        </For>
      </defs>
      <rect
        class="note-drawing-preview__background"
        x={bounds.x}
        y={bounds.y}
        width={bounds.width}
        height={bounds.height}
        fill={background}
      />
      <For each={props.document.elements}>
        {(element, index) => (
          <Show when={!element.isDeleted}>{previewElement(element, index(), markerPrefix)}</Show>
        )}
      </For>
    </svg>
  );
}

export function NoteDrawingPreview(props: {
  readonly blob: Blob;
  readonly label: string;
}): JSX.Element {
  const [document, setDocument] = createSignal<DrawingDocument | null>(null);

  createEffect(() => {
    const blob = props.blob;
    let disposed = false;
    setDocument(null);
    void parseDrawingBlob(blob).then((parsed) => {
      if (!disposed) setDocument(parsed);
    });
    onCleanup(() => {
      disposed = true;
    });
  });

  return (
    <Show
      when={document()}
      fallback={<div class="note-drawing-preview__empty">Не удалось показать схему</div>}
    >
      {(current) => <DrawingPreviewSvg document={current()} label={props.label} />}
    </Show>
  );
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  window.document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function NoteDrawingEditor(props: {
  readonly initial?: DrawingDocument;
  readonly title?: string;
  readonly onSave: (document: DrawingDocument) => void | Promise<void>;
  readonly onCancel: () => void;
}): JSX.Element {
  const initial = props.initial ?? createEmptyDrawing();
  let scene: DrawingScene = {
    elements: initial.elements,
    appState: initial.appState ?? {},
    files: initial.files ?? {},
  };
  const [runtime, setRuntime] = createSignal<ExcalidrawRuntime | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [exporting, setExporting] = createSignal(false);

  const handleSceneChange = (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ): void => {
    scene = { elements, appState, files };
  };

  const save = async (): Promise<void> => {
    const currentRuntime = runtime();
    if (!currentRuntime || saving()) return;
    setSaving(true);
    try {
      const serialized = currentRuntime.serializeAsJSON(
        scene.elements,
        scene.appState,
        scene.files,
        'local',
      );
      const document = parseDrawingDocument(serialized);
      if (!document) throw new Error('Редактор вернул неподдерживаемую схему.');
      await props.onSave(document);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось сохранить схему.');
    } finally {
      setSaving(false);
    }
  };

  const exportSvg = async (): Promise<void> => {
    const currentRuntime = runtime();
    if (!currentRuntime || exporting()) return;
    const elements = scene.elements.filter((element) => !element.isDeleted);
    if (elements.length === 0) {
      toast.info('Добавьте элементы перед экспортом.');
      return;
    }
    setExporting(true);
    try {
      const svg = await currentRuntime.exportToSvg({
        elements,
        appState: {
          ...scene.appState,
          exportBackground: true,
          exportWithDarkMode: false,
        },
        files: scene.files,
        renderEmbeddables: false,
        skipInliningFonts: true,
      });
      const markup = new XMLSerializer().serializeToString(svg);
      downloadBlob(new Blob([markup], { type: 'image/svg+xml' }), 'schema.svg');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось экспортировать SVG.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <OverlayDialog
      open
      title={props.title ?? 'Схема'}
      subtitle="Excalidraw сохраняется как редактируемое офлайн-вложение"
      class="note-drawing-dialog"
      bodyClass="note-drawing-dialog__body"
      tracksHistory={false}
      onClose={props.onCancel}
    >
      <div class="note-drawing-editor">
        <LazyExcalidraw
          initial={initial}
          onSceneChange={handleSceneChange}
          onRuntime={setRuntime}
        />
        <p class="note-drawing-editor__hint" aria-live="polite">
          Все данные схемы сохраняются локально. Внешние встраивания отключены.
        </p>
        <div class="note-drawing-editor__actions">
          <button
            type="button"
            class="note-drawing-editor__action"
            disabled={!runtime() || exporting()}
            onClick={() => void exportSvg()}
          >
            {exporting() ? 'Экспорт…' : 'Экспорт SVG'}
          </button>
          <button type="button" class="note-drawing-editor__action" onClick={props.onCancel}>
            Отмена
          </button>
          <button
            type="button"
            class="note-drawing-editor__action note-drawing-editor__action--primary"
            disabled={!runtime() || saving()}
            onClick={() => void save()}
          >
            {saving() ? 'Сохранение…' : 'Сохранить схему'}
          </button>
        </div>
      </div>
    </OverlayDialog>
  );
}
