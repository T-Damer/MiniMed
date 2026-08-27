import { DRAG_MODE, MULTIPLANAR_TYPE, type NiftiHeader, Niivue, SHOW_RENDER } from '@niivue/niivue';
import { decodeRLE, encodeRLE } from '@niivue/niivue/drawing';
import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import {
  type MedicalImageAnnotationTool,
  MedicalImageAnnotationToolbar,
} from '@/features/library/MedicalImageAnnotations';
import { MedicalImageTitle } from '@/features/library/MedicalImageTitle';
import {
  createMedicalImagePressRepeat,
  medicalImagePointerAction,
  medicalImageSliceDragSteps,
  readBlobWithProgress,
  volumeCutawayPlanes,
  withViewerTimeout,
} from '@/features/library/medical-image-utils';
import {
  getUserLibraryDocument,
  getUserLibraryFile,
  getUserLibraryMedicalAnnotationBitmap,
  putUserLibraryMedicalAnnotationBitmap,
  type UserLibraryMedicalAnnotationColor,
} from '@/state/user-library';
import '@/styles/dicom-viewer.css';

interface VolumeViewerProps {
  readonly documentId: string;
  readonly title: string;
  readonly onBack: () => void;
}

type VolumeView = 'multiplanar' | 'axial' | 'coronal' | 'sagittal' | 'render';
type SliceDragSource = 'canvas' | 'indicator';

const DEFAULT_RENDER_AZIMUTH = 45;
const DEFAULT_RENDER_ELEVATION = 45;

interface SliceDragState {
  readonly pointerId: number;
  readonly startY: number;
  readonly target: HTMLElement;
  readonly source: SliceDragSource;
  appliedSteps: number;
}

interface RenderCursorDragState {
  readonly pointerId: number;
  readonly target: HTMLElement;
}

interface MedicalImageDetail {
  readonly label: string;
  readonly value: string;
  readonly wide?: boolean;
}

function volumeDetails(fileName: string, header: NiftiHeader): readonly MedicalImageDetail[] {
  return [
    { label: 'Файл', value: fileName },
    { label: 'Область / описание', value: header.description.trim(), wide: true },
    { label: 'Заметки', value: header.aux_file.trim(), wide: true },
  ].filter((detail) => detail.value.length > 0);
}

function volumeErrorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message
    ? cause.message
    : 'Не удалось прочитать медицинский volume-файл.';
}

let thumbnailQueue = Promise.resolve<string | undefined>(undefined);

async function renderVolumeThumbnail(blob: Blob, name: string): Promise<string | undefined> {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  canvas.className = 'medical-image-thumbnail-canvas';
  document.body.append(canvas);
  const viewer = new Niivue({
    backColor: [0.02, 0.025, 0.03, 1],
    dragAndDropEnabled: false,
    forceDevicePixelRatio: -1,
    interactive: false,
    isResizeCanvas: false,
    isOrientationTextVisible: false,
  });
  try {
    await viewer.attachToCanvas(canvas, false);
    await withViewerTimeout(
      viewer.loadFromArrayBuffer(await blob.arrayBuffer(), name),
      'Превью volume-файла создаётся слишком долго.',
    );
    viewer.setSliceType(viewer.sliceTypeAxial);
    viewer.drawScene();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return canvas.toDataURL('image/jpeg', 0.76);
  } catch {
    return undefined;
  } finally {
    viewer.cleanup();
    canvas.remove();
  }
}

export function createVolumeThumbnail(blob: Blob, name: string): Promise<string | undefined> {
  const next = thumbnailQueue.then(
    () => renderVolumeThumbnail(blob, name),
    () => renderVolumeThumbnail(blob, name),
  );
  thumbnailQueue = next;
  return next;
}

export default function VolumeViewer(props: VolumeViewerProps): JSX.Element {
  const [loading, setLoading] = createSignal(true);
  const [progress, setProgress] = createSignal(0);
  const [loadingText, setLoadingText] = createSignal('Подготавливаем NiiVue…');
  const [error, setError] = createSignal<string | null>(null);
  const [activeView, setActiveView] = createSignal<VolumeView>('multiplanar');
  const [sliceIndex, setSliceIndex] = createSignal(0);
  const [sliceCount, setSliceCount] = createSignal(0);
  const [multiplanarAxis, setMultiplanarAxis] = createSignal<0 | 1 | 2>(2);
  const [details, setDetails] = createSignal<readonly MedicalImageDetail[]>([]);
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const [contrastActive, setContrastActive] = createSignal(false);
  const [rotationActive, setRotationActive] = createSignal(true);
  const [rotationButtonPosition, setRotationButtonPosition] =
    createSignal<readonly [number, number]>();
  const [annotationTool, setAnnotationTool] = createSignal<MedicalImageAnnotationTool>('none');
  const [annotationColor, setAnnotationColor] =
    createSignal<UserLibraryMedicalAnnotationColor>('red');
  const [annotationError, setAnnotationError] = createSignal<string>();
  let canvas: HTMLCanvasElement | undefined;
  let viewer: Niivue | undefined;
  let lastCutawayPosition = '';
  let annotationWrite = Promise.resolve();
  let annotationBitmapLength = 0;
  let undoHistory: Uint8Array[] = [];
  let redoHistory: Uint8Array[] = [];
  let sliceDrag: SliceDragState | undefined;
  let renderCursorDrag: RenderCursorDragState | undefined;
  let suppressCanvasInput = false;
  let canvasInputReleaseTimer: ReturnType<typeof setTimeout> | undefined;

  const isSinglePlane = (): boolean =>
    activeView() === 'axial' || activeView() === 'coronal' || activeView() === 'sagittal';

  const sliceAxis = (): 0 | 1 | 2 | null =>
    activeView() === 'sagittal'
      ? 0
      : activeView() === 'coronal'
        ? 1
        : activeView() === 'axial'
          ? 2
          : activeView() === 'multiplanar'
            ? multiplanarAxis()
            : null;

  const syncCutaway = (): void => {
    if (!viewer || (activeView() !== 'multiplanar' && activeView() !== 'render')) return;
    const position = viewer.scene.crosshairPos;
    const crosshair: [number, number, number] = [
      Number(position[0] ?? 0.5),
      Number(position[1] ?? 0.5),
      Number(position[2] ?? 0.5),
    ];
    const nextPosition = crosshair.join(':');
    if (nextPosition === lastCutawayPosition) return;
    lastCutawayPosition = nextPosition;
    viewer.setClipPlanes(volumeCutawayPlanes(crosshair));
  };

  const syncRotationButtonPosition = (): void => {
    const currentViewer = viewer;
    const renderTile = currentViewer?.screenSlices.find(
      (slice) => slice.axCorSag === currentViewer.sliceTypeRender,
    );
    if (!currentViewer || !renderTile) {
      setRotationButtonPosition(undefined);
      return;
    }
    const left = Number(renderTile.leftTopWidthHeight[0] ?? 0);
    const top = Number(renderTile.leftTopWidthHeight[1] ?? 0);
    const width = Number(renderTile.leftTopWidthHeight[2] ?? 0);
    if (width <= 0) {
      setRotationButtonPosition(undefined);
      return;
    }
    const dpr = currentViewer.uiData.dpr ?? window.devicePixelRatio;
    setRotationButtonPosition([(left + width) / dpr - 8, top / dpr + 8]);
  };

  const handleLocationChange = (event: Event): void => {
    const orientation = Number(
      (event as CustomEvent<{ readonly axCorSag?: unknown }>).detail?.axCorSag,
    );
    if (activeView() === 'multiplanar') {
      if (orientation === 0) setMultiplanarAxis(2);
      if (orientation === 1) setMultiplanarAxis(1);
      if (orientation === 2) setMultiplanarAxis(0);
    }
    syncSlice();
    syncCutaway();
  };

  const syncSlice = (): void => {
    const axis = sliceAxis();
    const dimensions = viewer?.volumes[0]?.dimsRAS;
    if (!viewer || axis === null || !dimensions) {
      setSliceIndex(0);
      setSliceCount(0);
      return;
    }
    const count = Number(dimensions[axis + 1] ?? 0);
    const voxel = viewer.frac2vox(viewer.scene.crosshairPos)[axis];
    setSliceCount(count);
    setSliceIndex(Math.min(count, Math.max(1, Math.round(voxel) + 1)));
  };

  const syncAnnotationTool = (): void => {
    if (!viewer) return;
    const tool = annotationTool();
    if (tool === 'pen') viewer.setPenValue(annotationColor() === 'red' ? 1 : 3);
    if (tool === 'eraser') viewer.setPenValue(0);
    viewer.setDrawingEnabled(tool !== 'none' && activeView() !== 'render' && !loading());
  };

  const syncContrastTool = (): void => {
    if (!viewer) return;
    const primary = contrastActive() ? DRAG_MODE.contrast : DRAG_MODE.crosshair;
    viewer.setMouseEventConfig({
      leftButton: { primary },
      rightButton: DRAG_MODE.contrast,
      centerButton: DRAG_MODE.contrast,
    });
    viewer.setTouchEventConfig({ singleTouch: primary, doubleTouch: DRAG_MODE.contrast });
  };

  const persistAnnotationBitmap = (snapshot: Uint8Array): void => {
    annotationWrite = annotationWrite
      .then(() => putUserLibraryMedicalAnnotationBitmap(props.documentId, snapshot))
      .catch((cause: unknown) => {
        setAnnotationError(
          cause instanceof Error ? cause.message : 'Не удалось сохранить разметку.',
        );
      });
  };

  const handleDrawingChanged = (event: Event): void => {
    const action = (event as CustomEvent<{ readonly action?: unknown }>).detail?.action;
    const bitmap = viewer?.drawBitmap;
    if (action !== 'draw' || !bitmap) return;
    const snapshot = bitmap.slice();
    undoHistory.push(encodeRLE(snapshot));
    if (undoHistory.length > 24) undoHistory.shift();
    redoHistory = [];
    persistAnnotationBitmap(snapshot);
    if (annotationTool() === 'pen') {
      setAnnotationTool('none');
      queueMicrotask(syncAnnotationTool);
    }
  };

  const restoreAnnotationHistory = (direction: 'undo' | 'redo'): void => {
    if (!viewer || annotationBitmapLength < 1) return;
    if (direction === 'undo') {
      if (undoHistory.length < 2) return;
      const current = undoHistory.pop();
      if (current) redoHistory.push(current);
    } else {
      const next = redoHistory.pop();
      if (!next) return;
      undoHistory.push(next);
    }
    const encoded = undoHistory.at(-1);
    if (!encoded) return;
    const bitmap = decodeRLE(encoded, annotationBitmapLength);
    viewer.drawBitmap = bitmap;
    viewer.refreshDrawing();
    persistAnnotationBitmap(bitmap);
  };

  const handleAnnotationShortcut = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'z') {
      event.preventDefault();
      restoreAnnotationHistory(event.shiftKey ? 'redo' : 'undo');
    } else if (key === 'y') {
      event.preventDefault();
      restoreAnnotationHistory('redo');
    }
  };

  const setView = (view: VolumeView): void => {
    if (!viewer) return;
    if (view === 'render') {
      setAnnotationTool('none');
      setContrastActive(false);
    }
    const sliceType =
      view === 'axial'
        ? viewer.sliceTypeAxial
        : view === 'coronal'
          ? viewer.sliceTypeCoronal
          : view === 'sagittal'
            ? viewer.sliceTypeSagittal
            : view === 'render'
              ? viewer.sliceTypeRender
              : viewer.sliceTypeMultiplanar;
    viewer.setSliceType(sliceType);
    setActiveView(view);
    if (view === 'multiplanar' || view === 'render') {
      lastCutawayPosition = '';
      syncCutaway();
    } else {
      viewer.drawScene();
    }
    queueMicrotask(() => {
      syncSlice();
      syncAnnotationTool();
      syncContrastTool();
      syncRotationButtonPosition();
    });
  };

  const selectAnnotationTool = (tool: MedicalImageAnnotationTool): void => {
    if (tool !== 'none' && activeView() === 'render') setView('multiplanar');
    if (tool !== 'none') setContrastActive(false);
    setAnnotationTool(tool);
    queueMicrotask(() => {
      syncAnnotationTool();
      syncContrastTool();
    });
  };

  const toggleContrastTool = (): void => {
    const next = !contrastActive();
    setContrastActive(next);
    if (next) setAnnotationTool('none');
    queueMicrotask(() => {
      syncAnnotationTool();
      syncContrastTool();
    });
  };

  const moveSlice = (delta: number): void => {
    if (!viewer || annotationTool() !== 'none' || sliceCount() < 2) return;
    const axis = sliceAxis();
    if (axis === null) return;
    const movement: [number, number, number] = [0, 0, 0];
    movement[axis] = delta;
    viewer.moveCrosshairInVox(...movement);
    viewer.drawScene();
    syncSlice();
  };

  const previousSliceRepeat = createMedicalImagePressRepeat(
    () => moveSlice(-1),
    () => !loading() && annotationTool() === 'none' && sliceIndex() > 1,
  );
  const nextSliceRepeat = createMedicalImagePressRepeat(
    () => moveSlice(1),
    () => !loading() && annotationTool() === 'none' && sliceIndex() < sliceCount(),
  );

  const canDragSlice = (source: SliceDragSource): boolean =>
    !loading() &&
    annotationTool() === 'none' &&
    sliceCount() > 1 &&
    sliceAxis() !== null &&
    (source === 'indicator' || isSinglePlane());

  const finishSliceDrag = (event?: PointerEvent): void => {
    if (!sliceDrag || (event && event.pointerId !== sliceDrag.pointerId)) return;
    const completed = sliceDrag;
    sliceDrag = undefined;
    if (completed.target.hasPointerCapture(completed.pointerId)) {
      completed.target.releasePointerCapture(completed.pointerId);
    }
    if (completed.source === 'canvas') {
      if (canvasInputReleaseTimer !== undefined) clearTimeout(canvasInputReleaseTimer);
      canvasInputReleaseTimer = setTimeout(() => {
        suppressCanvasInput = false;
      }, 0);
    }
  };

  const handleSliceDragMove = (event: PointerEvent): void => {
    if (!sliceDrag || event.pointerId !== sliceDrag.pointerId) return;
    if (!canDragSlice(sliceDrag.source)) {
      finishSliceDrag(event);
      return;
    }
    event.preventDefault();
    const pixelsPerStep = Math.max(2, Math.min(12, window.innerHeight / (sliceCount() - 1)));
    const steps = medicalImageSliceDragSteps(sliceDrag.startY, event.clientY, pixelsPerStep);
    const delta = steps - sliceDrag.appliedSteps;
    if (delta === 0) return;
    sliceDrag.appliedSteps = steps;
    moveSlice(delta);
  };

  const beginSliceDrag = (event: PointerEvent, source: SliceDragSource): void => {
    if (
      !event.isPrimary ||
      (event.pointerType === 'mouse' && event.button !== 0) ||
      !canDragSlice(source)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (source === 'canvas') {
      event.stopImmediatePropagation();
      suppressCanvasInput = true;
    }
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    sliceDrag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      target,
      source,
      appliedSteps: 0,
    };
  };

  const renderCursorPosition = (event: PointerEvent): { x: number; y: number } | undefined => {
    if (!viewer || !canvas) return undefined;
    return viewer.getNoPaddingNoBorderCanvasRelativeMousePosition(event, canvas);
  };

  const moveRenderCursor = (event: PointerEvent): void => {
    if (!viewer || !renderCursorDrag || event.pointerId !== renderCursorDrag.pointerId) return;
    const position = renderCursorPosition(event);
    if (!position) return;
    event.preventDefault();
    viewer.mouseDown(position.x, position.y);
    viewer.uiData.mouseDepthPicker = true;
    viewer.drawScene();
    viewer.drawScene();
    syncSlice();
    syncCutaway();
  };

  const finishRenderCursorDrag = (event?: PointerEvent): void => {
    if (!renderCursorDrag || (event && event.pointerId !== renderCursorDrag.pointerId)) return;
    const completed = renderCursorDrag;
    renderCursorDrag = undefined;
    if (completed.target.hasPointerCapture(completed.pointerId)) {
      completed.target.releasePointerCapture(completed.pointerId);
    }
    if (canvasInputReleaseTimer !== undefined) clearTimeout(canvasInputReleaseTimer);
    canvasInputReleaseTimer = setTimeout(() => {
      suppressCanvasInput = false;
    }, 0);
  };

  const beginCanvasDrag = (event: PointerEvent): void => {
    if (!viewer || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) {
      return;
    }
    const position = renderCursorPosition(event);
    const dpr = viewer.uiData.dpr ?? window.devicePixelRatio;
    const isRenderTile = Boolean(
      position && viewer.inRenderTile(position.x * dpr, position.y * dpr) >= 0,
    );
    const action = medicalImagePointerAction(
      activeView(),
      isRenderTile,
      canDragSlice('canvas'),
      contrastActive(),
      rotationActive(),
      annotationTool() !== 'none',
    );
    if (action === 'blocked') {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    if (action === 'slice') {
      beginSliceDrag(event, 'canvas');
      return;
    }
    if (action !== 'cursor') return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    suppressCanvasInput = true;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    renderCursorDrag = { pointerId: event.pointerId, target };
    moveRenderCursor(event);
  };

  const handleSliceKeyDown = (event: KeyboardEvent): void => {
    const delta =
      event.key === 'ArrowUp' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowDown' || event.key === 'ArrowLeft'
          ? -1
          : event.key === 'Home'
            ? 1 - sliceIndex()
            : event.key === 'End'
              ? sliceCount() - sliceIndex()
              : 0;
    if (delta === 0) return;
    event.preventDefault();
    moveSlice(delta);
  };

  const resetView = (): void => {
    if (!viewer) return;
    viewer.scene.crosshairPos = new Float32Array([0.5, 0.5, 0.5]);
    viewer.setRenderAzimuthElevation(DEFAULT_RENDER_AZIMUTH, DEFAULT_RENDER_ELEVATION);
    viewer.resetBriCon();
    lastCutawayPosition = '';
    if (activeView() === 'multiplanar' || activeView() === 'render') syncCutaway();
    else viewer.drawScene();
    syncSlice();
  };

  onMount(() => {
    const abortController = new AbortController();
    const mobileLayout = window.matchMedia('(max-width: 47.5rem)');
    const layoutObserver = new ResizeObserver(() => {
      requestAnimationFrame(syncRotationButtonPosition);
    });
    let cancelled = false;
    window.addEventListener('keydown', handleAnnotationShortcut);
    window.addEventListener('pointermove', handleSliceDragMove, { passive: false });
    window.addEventListener('pointermove', moveRenderCursor, { passive: false });
    window.addEventListener('pointerup', finishSliceDrag);
    window.addEventListener('pointerup', finishRenderCursorDrag);
    window.addEventListener('pointercancel', finishSliceDrag);
    window.addEventListener('pointercancel', finishRenderCursorDrag);

    const syncMultiplanarLayout = (): void => {
      viewer?.setMultiplanarLayout(
        mobileLayout.matches ? MULTIPLANAR_TYPE.GRID : MULTIPLANAR_TYPE.AUTO,
      );
      requestAnimationFrame(syncRotationButtonPosition);
    };
    const blockCanvasCompatibilityEvent = (event: Event): void => {
      let blockEvent = suppressCanvasInput;
      if (!blockEvent && annotationTool() !== 'none' && viewer && canvas) {
        const point =
          event instanceof MouseEvent
            ? event
            : event instanceof TouchEvent
              ? (event.touches[0] ?? event.changedTouches[0])
              : undefined;
        if (point) {
          const bounds = canvas.getBoundingClientRect();
          const dpr = viewer.uiData.dpr ?? window.devicePixelRatio;
          blockEvent =
            viewer.inRenderTile(
              (point.clientX - bounds.left) * dpr,
              (point.clientY - bounds.top) * dpr,
            ) >= 0;
        }
      }
      if (!blockEvent) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const blockSliceWheelWhileAnnotating = (event: WheelEvent): void => {
      if (annotationTool() === 'none') return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    canvas?.addEventListener('pointerdown', beginCanvasDrag, true);
    canvas?.addEventListener('mousedown', blockCanvasCompatibilityEvent, true);
    canvas?.addEventListener('mousemove', blockCanvasCompatibilityEvent, true);
    canvas?.addEventListener('mouseup', blockCanvasCompatibilityEvent, true);
    canvas?.addEventListener('touchstart', blockCanvasCompatibilityEvent, true);
    canvas?.addEventListener('touchmove', blockCanvasCompatibilityEvent, true);
    canvas?.addEventListener('touchend', blockCanvasCompatibilityEvent, true);
    canvas?.addEventListener('wheel', blockSliceWheelWhileAnnotating, {
      capture: true,
      passive: false,
    });
    if (canvas) layoutObserver.observe(canvas);
    mobileLayout.addEventListener('change', syncMultiplanarLayout);

    const open = async (): Promise<void> => {
      if (!canvas) return;
      const current = await getUserLibraryDocument(props.documentId);
      const blob = await getUserLibraryFile(props.documentId);
      if (!current || !blob) throw new Error('Volume-файл больше недоступен.');

      setLoadingText('Читаем volume-файл…');
      const buffer = await readBlobWithProgress(
        blob,
        (fraction) => setProgress(0.05 + fraction * 0.5),
        abortController.signal,
      );
      if (cancelled) return;

      setLoadingText('Запускаем медицинский viewer…');
      setProgress(0.62);
      viewer = new Niivue({
        backColor: [0.02, 0.025, 0.03, 1],
        dragAndDropEnabled: false,
        clipPlaneColor: [0, 0, 0, 0],
        isClipPlanesCutaway: true,
        isResizeCanvas: true,
        loadingText: '',
        multiplanarShowRender: SHOW_RENDER.ALWAYS,
        multiplanarLayout: mobileLayout.matches ? MULTIPLANAR_TYPE.GRID : MULTIPLANAR_TYPE.AUTO,
        show3Dcrosshair: true,
      });
      await viewer.attachToCanvas(canvas);
      viewer.addEventListener('locationChange', handleLocationChange);
      viewer.addEventListener('drawingChanged', handleDrawingChanged);
      if (cancelled) return;

      setLoadingText('Строим срезы…');
      setProgress(0.76);
      await withViewerTimeout(
        viewer.loadFromArrayBuffer(buffer, current.fileName),
        'NiiVue не завершил подготовку файла за 30 секунд.',
      );
      if (cancelled) return;
      viewer.setRenderAzimuthElevation(DEFAULT_RENDER_AZIMUTH, DEFAULT_RENDER_ELEVATION);
      const volume = viewer.volumes[0];
      if (volume?.hdr && volume.dimsRAS) {
        setDetails(volumeDetails(current.fileName, volume.hdr as NiftiHeader));
        const storedBitmap = await getUserLibraryMedicalAnnotationBitmap(props.documentId);
        const voxelCount = volume.dimsRAS.slice(1, 4).reduce((total, size) => total * size, 1);
        annotationBitmapLength = voxelCount;
        if (storedBitmap?.byteLength === voxelCount) {
          viewer.drawBitmap = storedBitmap;
        } else {
          viewer.createEmptyDrawing();
        }
        viewer.setDrawOpacity(0.88);
        viewer.refreshDrawing(false);
        if (viewer.drawBitmap) undoHistory = [encodeRLE(viewer.drawBitmap)];
      }
      setView('multiplanar');
      setProgress(1);
      setLoading(false);
    };

    void open().catch((cause: unknown) => {
      if (cancelled || (cause instanceof DOMException && cause.name === 'AbortError')) return;
      setError(volumeErrorMessage(cause));
      setLoading(false);
    });

    onCleanup(() => {
      cancelled = true;
      abortController.abort();
      window.removeEventListener('keydown', handleAnnotationShortcut);
      window.removeEventListener('pointermove', handleSliceDragMove);
      window.removeEventListener('pointermove', moveRenderCursor);
      window.removeEventListener('pointerup', finishSliceDrag);
      window.removeEventListener('pointerup', finishRenderCursorDrag);
      window.removeEventListener('pointercancel', finishSliceDrag);
      window.removeEventListener('pointercancel', finishRenderCursorDrag);
      canvas?.removeEventListener('pointerdown', beginCanvasDrag, true);
      canvas?.removeEventListener('wheel', blockSliceWheelWhileAnnotating, true);
      layoutObserver.disconnect();
      mobileLayout.removeEventListener('change', syncMultiplanarLayout);
      if (canvasInputReleaseTimer !== undefined) clearTimeout(canvasInputReleaseTimer);
      previousSliceRepeat.dispose();
      nextSliceRepeat.dispose();
      viewer?.cleanup();
      viewer = undefined;
    });
  });

  const tool = (
    view: VolumeView,
    label: string,
    icon:
      | 'squares-four'
      | 'arrows-out-line-horizontal'
      | 'arrows-out-line-vertical'
      | 'arrows-out-simple'
      | 'cube',
  ): JSX.Element => (
    <Button
      class="medical-image-viewer__tool medical-image-viewer__tool--icon"
      variant={activeView() === view ? 'primary' : 'secondary'}
      aria-label={label}
      title={label}
      aria-pressed={activeView() === view}
      disabled={loading()}
      onClick={() => setView(view)}
      icon={<AppGlyph name={icon} class="medical-image-viewer__tool-icon" />}
    />
  );

  return (
    <section
      class="medical-image-viewer medical-image-viewer--fullscreen"
      aria-label={`Медицинское изображение: ${props.title}`}
    >
      <nav class="medical-image-viewer__toolbar" aria-label="Режим просмотра volume">
        <div class="medical-image-viewer__toolbar-locked medical-image-viewer__toolbar-locked--leading">
          <Button
            class="medical-image-viewer__tool medical-image-viewer__tool--icon"
            variant="icon"
            aria-label="Назад"
            title="Назад"
            onClick={props.onBack}
            icon={<AppGlyph name="arrow-left" class="medical-image-viewer__tool-icon" />}
          />
          <MedicalImageTitle title={props.title} />
        </div>
        <div class="medical-image-viewer__toolbar-scroll">
          <div class="medical-image-viewer__toolbar-scroll-content">
            <div class="medical-image-viewer__tool-group">
              {tool('axial', 'Горизонтальная', 'arrows-out-line-vertical')}
              {tool('multiplanar', 'Все плоскости', 'squares-four')}
              {tool('coronal', 'Вертикальная', 'arrows-out-line-horizontal')}
              {tool('sagittal', 'Сагиттальная', 'arrows-out-simple')}
              {tool('render', '3D', 'cube')}
            </div>
            <fieldset class="medical-image-viewer__tool-group">
              <legend class="medical-image-viewer__tool-group-label">Настройка изображения</legend>
              <Button
                class="medical-image-viewer__tool medical-image-viewer__tool--icon"
                variant={contrastActive() ? 'primary' : 'secondary'}
                aria-label="Контраст по выделенной области"
                title="Контраст по выделенной области"
                aria-pressed={contrastActive()}
                disabled={loading() || activeView() === 'render'}
                onClick={toggleContrastTool}
                icon={<AppGlyph name="circle-half" class="medical-image-viewer__tool-icon" />}
              />
            </fieldset>
            <MedicalImageAnnotationToolbar
              tool={annotationTool()}
              color={annotationColor()}
              disabled={loading()}
              onToolChange={selectAnnotationTool}
              onColorChange={setAnnotationColor}
            />
          </div>
        </div>
        <div class="medical-image-viewer__toolbar-locked medical-image-viewer__toolbar-locked--trailing">
          <Button
            class="medical-image-viewer__tool medical-image-viewer__tool--icon"
            variant="icon"
            aria-label="Сбросить вид"
            title="Сбросить вид"
            disabled={loading()}
            onClick={resetView}
            icon={
              <AppGlyph name="arrow-counter-clockwise" class="medical-image-viewer__tool-icon" />
            }
          />
          <Button
            class="medical-image-viewer__tool medical-image-viewer__tool--icon"
            variant={detailsOpen() ? 'primary' : 'icon'}
            aria-label="Информация об исследовании"
            title="Информация об исследовании"
            aria-pressed={detailsOpen()}
            aria-expanded={detailsOpen()}
            onClick={() => setDetailsOpen((open) => !open)}
            icon={<AppGlyph name="info" class="medical-image-viewer__tool-icon" />}
          />
          <Show when={sliceAxis() !== null}>
            <fieldset
              class="medical-image-viewer__slice-navigation"
              onContextMenu={(event) => event.preventDefault()}
            >
              <legend class="medical-image-viewer__tool-group-label">Навигация по срезам</legend>
              <Button
                class="medical-image-viewer__tool medical-image-viewer__tool--icon"
                variant="icon"
                aria-label="Предыдущий срез"
                title="Предыдущий срез"
                disabled={loading() || annotationTool() !== 'none' || sliceIndex() <= 1}
                onPointerDown={previousSliceRepeat.start}
                onPointerUp={previousSliceRepeat.stop}
                onPointerCancel={previousSliceRepeat.stop}
                onPointerLeave={previousSliceRepeat.stop}
                onClick={previousSliceRepeat.activate}
                icon={<AppGlyph name="caret-left" class="medical-image-viewer__tool-icon" />}
              />
              <span
                class="medical-image-viewer__slice"
                role="slider"
                tabIndex={annotationTool() === 'none' ? 0 : -1}
                aria-label="Номер среза"
                aria-disabled={annotationTool() !== 'none'}
                aria-orientation="vertical"
                aria-valuemin={1}
                aria-valuemax={Math.max(1, sliceCount())}
                aria-valuenow={Math.max(1, sliceIndex())}
                aria-valuetext={`${String(sliceIndex())} из ${String(sliceCount())}`}
                onPointerDown={(event) => beginSliceDrag(event, 'indicator')}
                onKeyDown={handleSliceKeyDown}
              >
                {sliceCount() > 0 ? `${String(sliceIndex())} / ${String(sliceCount())}` : '— / —'}
              </span>
              <Button
                class="medical-image-viewer__tool medical-image-viewer__tool--icon"
                variant="icon"
                aria-label="Следующий срез"
                title="Следующий срез"
                disabled={loading() || annotationTool() !== 'none' || sliceIndex() >= sliceCount()}
                onPointerDown={nextSliceRepeat.start}
                onPointerUp={nextSliceRepeat.stop}
                onPointerCancel={nextSliceRepeat.stop}
                onPointerLeave={nextSliceRepeat.stop}
                onClick={nextSliceRepeat.activate}
                icon={<AppGlyph name="caret-right" class="medical-image-viewer__tool-icon" />}
              />
            </fieldset>
          </Show>
        </div>
      </nav>
      <div class="medical-image-viewer__stage">
        <canvas
          ref={canvas}
          class="medical-image-viewer__canvas"
          classList={{
            'medical-image-viewer__canvas--pen-red':
              annotationTool() === 'pen' && annotationColor() === 'red',
            'medical-image-viewer__canvas--pen-blue':
              annotationTool() === 'pen' && annotationColor() === 'blue',
            'medical-image-viewer__canvas--eraser': annotationTool() === 'eraser',
            'medical-image-viewer__canvas--slice-drag':
              isSinglePlane() && annotationTool() === 'none' && !contrastActive() && !loading(),
            'medical-image-viewer__canvas--contrast': contrastActive() && !loading(),
            'medical-image-viewer__canvas--cursor-drag':
              (activeView() === 'multiplanar' || activeView() === 'render') &&
              annotationTool() === 'none' &&
              !rotationActive() &&
              !loading(),
            'medical-image-viewer__canvas--rotate':
              (activeView() === 'multiplanar' || activeView() === 'render') &&
              annotationTool() === 'none' &&
              rotationActive() &&
              !loading(),
          }}
          aria-label="Область NiiVue"
        />
        <Show when={!loading() && !error() && rotationButtonPosition()}>
          {(position) => (
            <Button
              class="medical-image-viewer__tool medical-image-viewer__tool--icon medical-image-viewer__rotation-button"
              style={{ left: `${String(position()[0])}px`, top: `${String(position()[1])}px` }}
              variant={rotationActive() ? 'primary' : 'secondary'}
              aria-label="Вращать 3D"
              title="Вращать 3D"
              aria-pressed={rotationActive()}
              disabled={annotationTool() !== 'none'}
              onClick={() => {
                const next = !rotationActive();
                setRotationActive(next);
                if (next) {
                  setContrastActive(false);
                  setAnnotationTool('none');
                  queueMicrotask(() => {
                    syncAnnotationTool();
                    syncContrastTool();
                  });
                }
              }}
              icon={<AppGlyph name="sphere" class="medical-image-viewer__tool-icon" />}
            />
          )}
        </Show>
        <Show when={detailsOpen()}>
          <aside class="medical-image-viewer__details" aria-label="Информация об исследовании">
            <strong class="medical-image-viewer__details-title">Данные снимка</strong>
            <dl class="medical-image-viewer__details-list">
              <For each={details()}>
                {(detail) => (
                  <div
                    class="medical-image-viewer__details-row"
                    classList={{ 'medical-image-viewer__details-row--wide': detail.wide }}
                  >
                    <dt class="medical-image-viewer__details-label">{detail.label}</dt>
                    <dd class="medical-image-viewer__details-value">{detail.value}</dd>
                  </div>
                )}
              </For>
            </dl>
          </aside>
        </Show>
        <Show when={annotationError()}>
          {(message) => (
            <span class="medical-image-viewer__annotation-error" role="alert">
              {message()}
            </span>
          )}
        </Show>
        <Show when={loading()}>
          <div class="medical-image-viewer__loading" role="status">
            <span class="medical-image-viewer__spinner" aria-hidden="true" />
            <span class="medical-image-viewer__loading-text">{loadingText()}</span>
            <progress class="medical-image-viewer__progress" max={1} value={progress()} />
          </div>
        </Show>
        <Show when={error()}>
          {(message) => (
            <div class="medical-image-viewer__error" role="alert">
              <strong class="medical-image-viewer__error-title">
                Не удалось открыть исследование
              </strong>
              <span class="medical-image-viewer__error-text">{message()}</span>
            </div>
          )}
        </Show>
      </div>
    </section>
  );
}
