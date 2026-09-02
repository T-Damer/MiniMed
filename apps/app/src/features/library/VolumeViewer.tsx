import { DRAG_MODE, MULTIPLANAR_TYPE, type NiftiHeader, Niivue, SHOW_RENDER } from '@niivue/niivue';
import { decodeRLE, encodeRLE } from '@niivue/niivue/drawing';
import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import {
  type MedicalImageAnnotationTool,
  MedicalImageAnnotationToolbar,
} from '@/features/library/MedicalImageAnnotations';
import { MedicalImagePrintDialog } from '@/features/library/MedicalImagePrintDialog';
import {
  hasPhysicalKeyboard,
  MedicalImageSliceIndicator,
  MedicalImageSliceNavigation,
  MedicalImageViewerToolbar,
} from '@/features/library/MedicalImageViewerToolbar';
import {
  captureMedicalImageFrame,
  type MedicalImagePrintCaptureOptions,
  type MedicalImagePrintDirection,
  type MedicalImagePrintFrame,
  waitForMedicalImagePaint,
} from '@/features/library/medical-image-print';
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

export { createVolumeThumbnail } from './volume-thumbnail';

interface VolumeViewerProps {
  readonly documentId: string;
  readonly title: string;
  readonly onBack: () => void;
}

type VolumeView = 'multiplanar' | 'axial' | 'coronal' | 'sagittal' | 'render';
type VolumeAxis = 0 | 1 | 2;
type SliceDragSource = 'canvas' | 'indicator';
type TouchGestureMode = 'single-plane' | 'contrast' | 'render-slice';
type GridCrosshairView = 'axial' | 'coronal' | 'sagittal';

const DEFAULT_RENDER_AZIMUTH = 45;
const DEFAULT_RENDER_ELEVATION = 45;
const TOUCH_SWIPE_THRESHOLD = 10;
const PINCH_ZOOM_MIN = 0.1;
const PINCH_ZOOM_MAX = 10;
const VOLUME_AXIS_LABELS = ['X', 'Y', 'Z'] as const;

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

interface TouchGestureState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly target: HTMLElement;
  readonly mode: TouchGestureMode;
  currentX: number;
  currentY: number;
  appliedSteps: number;
  swiping: boolean;
}

interface PinchGestureState {
  readonly pointerIds: readonly [number, number];
  readonly target: HTMLElement;
  firstX: number;
  firstY: number;
  secondX: number;
  secondY: number;
  lastDistance: number;
}

interface GridCrosshairState {
  readonly view: GridCrosshairView;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
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

function resetVolumeContrast(viewer: Niivue): void {
  const volume = viewer.volumes[0];
  if (!volume) return;
  const { robust_min: robustMin, robust_max: robustMax } = volume;
  if (robustMin === undefined || robustMax === undefined) return;
  volume.cal_min = robustMin;
  volume.cal_max = robustMax;
  viewer.onIntensityChange(volume);
  viewer.refreshLayers(volume, 0);
  viewer.drawScene();
}

function volumeErrorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message
    ? cause.message
    : 'Не удалось прочитать медицинский volume-файл.';
}

export default function VolumeViewer(props: VolumeViewerProps): JSX.Element {
  const [loading, setLoading] = createSignal(true);
  const [progress, setProgress] = createSignal(0);
  const [loadingText, setLoadingText] = createSignal('Подготавливаем NiiVue…');
  const [error, setError] = createSignal<string | null>(null);
  const [activeView, setActiveView] = createSignal<VolumeView>('multiplanar');
  const [volumeDimensions, setVolumeDimensions] = createSignal<readonly number[]>([]);
  const [sliceIndex, setSliceIndex] = createSignal(0);
  const [sliceCount, setSliceCount] = createSignal(0);
  const [multiplanarAxis, setMultiplanarAxis] = createSignal<0 | 1 | 2>(2);
  const [renderSliceAxis, setRenderSliceAxis] = createSignal<VolumeAxis>(2);
  const [details, setDetails] = createSignal<readonly MedicalImageDetail[]>([]);
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const [printOpen, setPrintOpen] = createSignal(false);
  const [contrastActive, setContrastActive] = createSignal(false);
  const [rotationActive, setRotationActive] = createSignal(true);
  const [gridCrosshairs, setGridCrosshairs] = createSignal<readonly GridCrosshairState[]>([]);
  const [rotationButtonPosition, setRotationButtonPosition] =
    createSignal<readonly [number, number]>();
  const [annotationTool, setAnnotationTool] = createSignal<MedicalImageAnnotationTool>('none');
  const [annotationColor, setAnnotationColor] =
    createSignal<UserLibraryMedicalAnnotationColor>('red');
  const [annotationError, setAnnotationError] = createSignal<string>();
  let canvas: HTMLCanvasElement | undefined;
  let stageElement: HTMLDivElement | undefined;
  let viewer: Niivue | undefined;
  let lastCutawayPosition = '';
  let annotationWrite = Promise.resolve();
  let annotationBitmapLength = 0;
  let undoHistory: Uint8Array[] = [];
  let redoHistory: Uint8Array[] = [];
  let sliceDrag: SliceDragState | undefined;
  let renderCursorDrag: RenderCursorDragState | undefined;
  let touchGesture: TouchGestureState | undefined;
  let pinchGesture: PinchGestureState | undefined;
  let sliceMoveFrame: number | undefined;
  let pendingSliceDelta = 0;
  let contrastMoveFrame: number | undefined;
  let pendingContrastPosition: { x: number; y: number } | undefined;
  let pinchZoomFrame: number | undefined;
  let pendingPinchZoomFactor = 1;
  let renderCursorFrame: number | undefined;
  let pendingRenderCursorPosition: { x: number; y: number } | undefined;
  let suppressCanvasInput = false;
  let canvasInputReleaseTimer: ReturnType<typeof setTimeout> | undefined;
  let printCaptureQueue: Promise<void> = Promise.resolve();

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
            : activeView() === 'render'
              ? renderSliceAxis()
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

  const syncGridCrosshairs = (): void => {
    const currentViewer = viewer;
    if (!currentViewer || activeView() !== 'multiplanar') {
      if (gridCrosshairs().length > 0) setGridCrosshairs([]);
      return;
    }
    const dpr = currentViewer.uiData.dpr ?? window.devicePixelRatio;
    const crosshair = currentViewer.scene.crosshairPos;
    const slices: readonly { view: GridCrosshairView; sliceType: number }[] = [
      { view: 'axial', sliceType: currentViewer.sliceTypeAxial },
      { view: 'coronal', sliceType: currentViewer.sliceTypeCoronal },
      { view: 'sagittal', sliceType: currentViewer.sliceTypeSagittal },
    ];
    const next = slices.flatMap(({ view, sliceType }) => {
      const result = currentViewer.frac2canvasPosWithTile(crosshair, sliceType);
      const tile = result ? currentViewer.screenSlices[result.tileIndex] : undefined;
      if (!result || !tile) return [];
      const left = Number(tile.leftTopWidthHeight[0] ?? 0) / dpr;
      const top = Number(tile.leftTopWidthHeight[1] ?? 0) / dpr;
      const width = Number(tile.leftTopWidthHeight[2] ?? 0) / dpr;
      const height = Number(tile.leftTopWidthHeight[3] ?? 0) / dpr;
      if (width <= 0 || height <= 0) return [];
      const x = Number(result.pos[0] ?? 0) / dpr - left;
      const y = Number(result.pos[1] ?? 0) / dpr - top;
      return [
        {
          view,
          left,
          top,
          width,
          height,
          x: Math.max(0, Math.min(width, x)),
          y: Math.max(0, Math.min(height, y)),
        },
      ];
    });
    const previous = gridCrosshairs();
    if (
      next.length === previous.length &&
      next.every((item, index) => {
        const current = previous[index];
        return (
          current?.view === item.view &&
          current.left === item.left &&
          current.top === item.top &&
          current.width === item.width &&
          current.height === item.height &&
          current.x === item.x &&
          current.y === item.y
        );
      })
    ) {
      return;
    }
    setGridCrosshairs(next);
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
    if (activeView() === 'multiplanar') syncGridCrosshairs();
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
    viewer.setTouchEventConfig({
      singleTouch: contrastActive() ? DRAG_MODE.windowing : primary,
      doubleTouch: DRAG_MODE.none,
    });
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

  const handleViewerShortcut = (event: KeyboardEvent): void => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey) {
      if (event.altKey) return;
      if (key === 'z') {
        event.preventDefault();
        restoreAnnotationHistory(event.shiftKey ? 'redo' : 'undo');
      } else if (key === 'y') {
        event.preventDefault();
        restoreAnnotationHistory('redo');
      }
      return;
    }
    if (event.altKey) return;
    if (key === 'r') {
      event.preventDefault();
      resetView();
    } else if (key === 'i') {
      event.preventDefault();
      setDetailsOpen((open) => !open);
    } else if (key === 'backspace') {
      event.preventDefault();
      props.onBack();
    } else if (key === 'c') {
      event.preventDefault();
      toggleContrastTool();
    } else if (key === 'd') {
      event.preventDefault();
      selectAnnotationTool('pen');
    } else if (key === 'e') {
      event.preventDefault();
      selectAnnotationTool('eraser');
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
    viewer.setCrosshairWidth(view === 'multiplanar' ? 0 : 1);
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
      syncGridCrosshairs();
    });
  };

  const cycleRenderSliceAxis = (): void => {
    if (activeView() !== 'render') return;
    setRenderSliceAxis((axis) => (axis === 2 ? 0 : ((axis + 1) as VolumeAxis)));
    queueMicrotask(syncSlice);
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
    if (loading() || activeView() === 'render') return;
    const next = !contrastActive();
    setContrastActive(next);
    if (next) setAnnotationTool('none');
    queueMicrotask(() => {
      syncAnnotationTool();
      syncContrastTool();
    });
  };

  const flushPinchZoom = (): void => {
    pinchZoomFrame = undefined;
    const factor = pendingPinchZoomFactor;
    pendingPinchZoomFactor = 1;
    if (!viewer || factor === 1 || (!isSinglePlane() && activeView() !== 'render')) return;
    if (isSinglePlane()) {
      const currentZoom = viewer.scene.pan2Dxyzmm[3];
      viewer.scene.pan2Dxyzmm[3] = Math.min(
        PINCH_ZOOM_MAX,
        Math.max(PINCH_ZOOM_MIN, currentZoom * factor),
      );
      viewer.drawScene();
      return;
    }
    viewer.setScale(
      Math.min(PINCH_ZOOM_MAX, Math.max(PINCH_ZOOM_MIN, viewer.volScaleMultiplier * factor)),
    );
  };

  const schedulePinchZoom = (factor: number): void => {
    pendingPinchZoomFactor *= factor;
    if (pinchZoomFrame !== undefined) return;
    pinchZoomFrame = requestAnimationFrame(flushPinchZoom);
  };

  const finishPinchGesture = (event?: PointerEvent): void => {
    const pinch = pinchGesture;
    if (!pinch || (event && !pinch.pointerIds.includes(event.pointerId))) return;
    if (event) event.preventDefault();
    flushPinchZoom();
    for (const pointerId of pinch.pointerIds) {
      if (pinch.target.hasPointerCapture(pointerId)) pinch.target.releasePointerCapture(pointerId);
    }
    pinchGesture = undefined;
    touchGesture = undefined;
    if (canvasInputReleaseTimer !== undefined) clearTimeout(canvasInputReleaseTimer);
    canvasInputReleaseTimer = setTimeout(() => {
      suppressCanvasInput = false;
    }, 0);
  };

  const handlePinchGestureMove = (event: PointerEvent): void => {
    const pinch = pinchGesture;
    if (!pinch?.pointerIds.includes(event.pointerId)) return;
    event.preventDefault();
    if (event.pointerId === pinch.pointerIds[0]) {
      pinch.firstX = event.clientX;
      pinch.firstY = event.clientY;
    } else {
      pinch.secondX = event.clientX;
      pinch.secondY = event.clientY;
    }
    const distance = Math.hypot(pinch.secondX - pinch.firstX, pinch.secondY - pinch.firstY);
    if (pinch.lastDistance > 0 && distance > 0) {
      schedulePinchZoom(distance / pinch.lastDistance);
    }
    pinch.lastDistance = distance;
  };

  const moveSlice = (delta: number, axis: VolumeAxis | null = sliceAxis()): void => {
    if (!viewer || annotationTool() !== 'none' || sliceCount() < 2) return;
    if (axis === null) return;
    const movement: [number, number, number] = [0, 0, 0];
    movement[axis] = delta;
    viewer.moveCrosshairInVox(...movement);
    syncSlice();
    syncGridCrosshairs();
  };

  const flushSliceMove = (): void => {
    sliceMoveFrame = undefined;
    const delta = pendingSliceDelta;
    pendingSliceDelta = 0;
    if (delta !== 0) moveSlice(delta);
  };

  const scheduleSliceMove = (delta: number): void => {
    pendingSliceDelta += delta;
    if (sliceMoveFrame !== undefined) return;
    sliceMoveFrame = requestAnimationFrame(flushSliceMove);
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
    scheduleSliceMove(delta);
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

  const flushContrastMove = (): void => {
    contrastMoveFrame = undefined;
    const position = pendingContrastPosition;
    pendingContrastPosition = undefined;
    if (!viewer || !touchGesture || touchGesture.mode !== 'contrast' || !position) return;
    viewer.windowingHandler(position.x, position.y);
    viewer.drawScene();
  };

  const scheduleContrastMove = (position: { x: number; y: number }): void => {
    pendingContrastPosition = position;
    if (contrastMoveFrame !== undefined) return;
    contrastMoveFrame = requestAnimationFrame(flushContrastMove);
  };

  const applyTouchCursor = (event: PointerEvent): void => {
    const position = renderCursorPosition(event);
    if (!viewer || !position) return;
    viewer.mouseClick(position.x, position.y);
    syncSlice();
    syncCutaway();
    syncGridCrosshairs();
  };

  const beginTouchGesture = (event: PointerEvent): boolean => {
    if (
      !viewer ||
      !canvas ||
      event.pointerType === 'mouse' ||
      loading() ||
      annotationTool() !== 'none'
    ) {
      return false;
    }
    const existing = touchGesture;
    if (existing && event.pointerId !== existing.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);
      pendingSliceDelta = 0;
      pendingContrastPosition = undefined;
      pinchGesture = {
        pointerIds: [existing.pointerId, event.pointerId],
        target,
        firstX: existing.currentX,
        firstY: existing.currentY,
        secondX: event.clientX,
        secondY: event.clientY,
        lastDistance: Math.hypot(
          event.clientX - existing.currentX,
          event.clientY - existing.currentY,
        ),
      };
      touchGesture = undefined;
      return true;
    }
    if (!event.isPrimary) return false;
    const mode: TouchGestureMode | undefined =
      contrastActive() && activeView() !== 'render'
        ? 'contrast'
        : isSinglePlane()
          ? 'single-plane'
          : activeView() === 'render'
            ? 'render-slice'
            : undefined;
    if (!mode) return false;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    suppressCanvasInput = true;
    touchGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      target,
      mode,
      currentX: event.clientX,
      currentY: event.clientY,
      appliedSteps: 0,
      swiping: false,
    };
    if (mode === 'contrast') {
      const position = renderCursorPosition(event);
      if (position) {
        viewer.uiData.windowX = position.x;
        viewer.uiData.windowY = position.y;
      }
    }
    return true;
  };

  const handleTouchGestureMove = (event: PointerEvent): void => {
    const gesture = touchGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.currentX = event.clientX;
    gesture.currentY = event.clientY;
    const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
    if (!gesture.swiping) {
      if (distance < TOUCH_SWIPE_THRESHOLD) return;
      gesture.swiping = true;
    }
    event.preventDefault();
    if (gesture.mode === 'contrast') {
      const position = renderCursorPosition(event);
      if (position) scheduleContrastMove(position);
      return;
    }
    const pixelsPerStep = Math.max(2, Math.min(12, window.innerHeight / (sliceCount() - 1)));
    const steps = medicalImageSliceDragSteps(gesture.startY, event.clientY, pixelsPerStep);
    const delta = steps - gesture.appliedSteps;
    if (delta === 0) return;
    gesture.appliedSteps = steps;
    scheduleSliceMove(delta);
  };

  const finishTouchGesture = (event?: PointerEvent): void => {
    const gesture = touchGesture;
    if (!gesture || (event && event.pointerId !== gesture.pointerId)) return;
    if (event) event.preventDefault();
    if (gesture.mode === 'contrast' && pendingContrastPosition) flushContrastMove();
    if (gesture.mode !== 'contrast' && pendingSliceDelta !== 0) flushSliceMove();
    if (
      !gesture.swiping &&
      gesture.mode === 'single-plane' &&
      event?.type !== 'pointercancel' &&
      event
    ) {
      applyTouchCursor(event);
    }
    touchGesture = undefined;
    if (gesture.target.hasPointerCapture(gesture.pointerId)) {
      gesture.target.releasePointerCapture(gesture.pointerId);
    }
    if (canvasInputReleaseTimer !== undefined) clearTimeout(canvasInputReleaseTimer);
    canvasInputReleaseTimer = setTimeout(() => {
      suppressCanvasInput = false;
    }, 0);
  };

  const flushRenderCursorMove = (): void => {
    renderCursorFrame = undefined;
    const position = pendingRenderCursorPosition;
    pendingRenderCursorPosition = undefined;
    const currentViewer = viewer;
    if (!currentViewer || !renderCursorDrag || !position) return;
    currentViewer.mouseDown(position.x, position.y);
    currentViewer.uiData.mouseDepthPicker = true;
    currentViewer.drawScene();
    syncSlice();
    syncCutaway();
  };

  const moveRenderCursor = (event: PointerEvent): void => {
    if (!viewer || !renderCursorDrag || event.pointerId !== renderCursorDrag.pointerId) return;
    const position = renderCursorPosition(event);
    if (!position) return;
    event.preventDefault();
    pendingRenderCursorPosition = position;
    if (renderCursorFrame === undefined) {
      renderCursorFrame = requestAnimationFrame(flushRenderCursorMove);
    }
  };

  const finishRenderCursorDrag = (event?: PointerEvent): void => {
    if (!renderCursorDrag || (event && event.pointerId !== renderCursorDrag.pointerId)) return;
    if (pendingRenderCursorPosition) flushRenderCursorMove();
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
    if (event.pointerType !== 'mouse' && beginTouchGesture(event)) return;
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
    resetVolumeContrast(viewer);
    lastCutawayPosition = '';
    if (activeView() === 'multiplanar' || activeView() === 'render') syncCutaway();
    else viewer.drawScene();
    syncSlice();
    syncGridCrosshairs();
  };

  const viewLabel = (): string =>
    activeView() === 'multiplanar'
      ? '2×2 — все плоскости'
      : activeView() === 'render'
        ? '3D'
        : activeView() === 'axial'
          ? 'аксиальный срез'
          : activeView() === 'coronal'
            ? 'корональный срез'
            : 'сагиттальный срез';

  const printAxis = (directionId: MedicalImagePrintDirection['id']): VolumeAxis | null =>
    directionId === 'sagittal'
      ? 0
      : directionId === 'coronal'
        ? 1
        : directionId === 'axial'
          ? 2
          : null;

  const printDirections = (): readonly MedicalImagePrintDirection[] => {
    const dimensions = volumeDimensions();
    const countFor = (axis: VolumeAxis): number => Math.max(0, Number(dimensions?.[axis + 1] ?? 0));
    const currentFor = (axis: VolumeAxis): number => {
      const count = countFor(axis);
      if (!viewer || count < 1) return 1;
      const voxel = viewer.frac2vox(viewer.scene.crosshairPos)[axis];
      return Math.min(count, Math.max(1, Math.round(voxel) + 1));
    };
    return [
      {
        id: 'axial',
        label: 'Аксиальные срезы',
        icon: 'arrows-out-line-vertical',
        count: countFor(2),
        current: currentFor(2),
      },
      {
        id: 'coronal',
        label: 'Корональные срезы',
        icon: 'arrows-out-line-horizontal',
        count: countFor(1),
        current: currentFor(1),
      },
      {
        id: 'sagittal',
        label: 'Сагиттальные срезы',
        icon: 'arrows-out-simple',
        count: countFor(0),
        current: currentFor(0),
      },
      {
        id: 'grid',
        label: 'Сеточный вид',
        icon: 'squares-four',
        count: Math.max(countFor(0), countFor(1), countFor(2)),
        current: currentFor(2),
      },
    ];
  };

  const printDirectionForView = (): MedicalImagePrintDirection['id'] => {
    const view = activeView();
    return view === 'axial' || view === 'coronal' || view === 'sagittal'
      ? view
      : view === 'multiplanar'
        ? 'grid'
        : 'axial';
  };

  const capturePrintFrames = async (
    options: MedicalImagePrintCaptureOptions,
  ): Promise<readonly MedicalImagePrintFrame[]> => {
    const currentViewer = viewer;
    const currentStage = stageElement;
    const volume = currentViewer?.volumes[0];
    if (!currentViewer || !currentStage || !volume) return [];

    let releaseCapture: (() => void) | undefined;
    const captureSlot = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    const previousCapture = printCaptureQueue;
    printCaptureQueue = previousCapture.then(() => captureSlot);
    await previousCapture;
    if (options.signal?.aborted) {
      releaseCapture?.();
      return [];
    }

    const originalView = activeView();
    const originalCrosshair = new Float32Array(currentViewer.scene.crosshairPos);
    const originalMosaic = currentViewer.sliceMosaicString;
    const originalDrawing = currentViewer.drawBitmap?.slice();
    const result: MedicalImagePrintFrame[] = [];
    const direction = printDirections().find((candidate) => candidate.id === options.directionId);
    const directionLabel = direction?.label ?? viewLabel();

    if (!options.includeAnnotations && originalDrawing) {
      currentViewer.drawBitmap = new Uint8Array(originalDrawing.length);
      currentViewer.refreshDrawing(false);
    }

    try {
      const axis = printAxis(options.directionId);
      if (options.directionId === 'grid') {
        const gridDirections = printDirections().filter((candidate) => candidate.id !== 'grid');
        for (const gridDirection of gridDirections) {
          const gridAxis = printAxis(gridDirection.id);
          if (gridAxis === null || gridDirection.count < 1) continue;
          const gridSlices = options.slices.filter(
            (slice) => slice >= 1 && slice <= gridDirection.count,
          );
          for (let offset = 0; offset < gridSlices.length; offset += 16) {
            if (options.signal?.aborted) return result;
            const group = gridSlices.slice(offset, offset + 16);
            const mosaicRows: string[] = [];
            for (let row = 0; row < group.length; row += 4) {
              const rowTokens = group.slice(row, row + 4).map((requestedSlice) => {
                const crosshair = new Float32Array(originalCrosshair);
                const index = requestedSlice - 1;
                crosshair[gridAxis] =
                  gridDirection.count > 1 ? index / (gridDirection.count - 1) : 0.5;
                const position = currentViewer.frac2mm(crosshair)[gridAxis];
                return Number.isFinite(position) ? String(position) : '';
              });
              mosaicRows.push(
                `${gridAxis === 0 ? 'S' : gridAxis === 1 ? 'C' : 'A'} ${rowTokens.join(' ')}`,
              );
            }
            const sliceLabel = `Срезы ${String(group[0])}–${String(group[group.length - 1])} из ${String(gridDirection.count)}`;
            currentViewer.setSliceMosaicString(mosaicRows.join(' ; '));
            currentViewer.drawScene();
            await waitForMedicalImagePaint();
            if (options.signal?.aborted) return result;
            const captured = captureMedicalImageFrame(
              currentStage,
              options.includeAnnotations,
              () => currentViewer.drawScene(),
            );
            if (captured) {
              result.push({
                ...captured,
                directionLabel: `${gridDirection.label} · сетка`,
                sliceLabel,
                series: props.title,
                details: [
                  ...details(),
                  { label: 'Режим', value: 'Сеточный вид' },
                  { label: 'Срез', value: sliceLabel },
                ],
              });
            }
          }
        }
      } else if (axis !== null && direction) {
        const count = direction.count;
        const sliceType =
          axis === 0
            ? currentViewer.sliceTypeSagittal
            : axis === 1
              ? currentViewer.sliceTypeCoronal
              : currentViewer.sliceTypeAxial;
        currentViewer.setCrosshairWidth(0);
        currentViewer.setSliceType(sliceType);
        for (const requestedSlice of options.slices) {
          if (options.signal?.aborted) return result;
          const index = Math.min(count - 1, Math.max(0, requestedSlice - 1));
          const crosshair = new Float32Array(currentViewer.scene.crosshairPos);
          crosshair[axis] = count > 1 ? index / (count - 1) : 0.5;
          currentViewer.scene.crosshairPos = crosshair;
          currentViewer.drawScene();
          await waitForMedicalImagePaint();
          if (options.signal?.aborted) return result;
          const captured = captureMedicalImageFrame(currentStage, options.includeAnnotations, () =>
            currentViewer.drawScene(),
          );
          if (!captured) continue;
          const sliceLabel = `Срез ${String(index + 1)} из ${String(count)}`;
          result.push({
            ...captured,
            directionLabel,
            sliceLabel,
            series: props.title,
            details: [
              ...details(),
              { label: 'Режим', value: directionLabel },
              { label: 'Срез', value: sliceLabel },
            ],
          });
        }
      }
    } finally {
      try {
        if (!options.includeAnnotations && originalDrawing) {
          currentViewer.drawBitmap = originalDrawing;
          currentViewer.refreshDrawing(false);
        }
        currentViewer.setSliceMosaicString(originalMosaic);
        currentViewer.scene.crosshairPos = originalCrosshair;
        lastCutawayPosition = '';
        setView(originalView);
        if (originalView === 'multiplanar' || originalView === 'render') {
          lastCutawayPosition = '';
          syncCutaway();
        }
        currentViewer.drawScene();
        syncSlice();
        syncGridCrosshairs();
      } finally {
        releaseCapture?.();
      }
    }
    return result;
  };

  onMount(() => {
    const abortController = new AbortController();
    const mobileLayout = window.matchMedia('(max-width: 47.5rem)');
    const layoutObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        syncRotationButtonPosition();
        syncGridCrosshairs();
      });
    });
    let cancelled = false;
    window.addEventListener('keydown', handleViewerShortcut);
    window.addEventListener('pointermove', handleSliceDragMove, { passive: false });
    window.addEventListener('pointermove', moveRenderCursor, { passive: false });
    window.addEventListener('pointermove', handlePinchGestureMove, { passive: false });
    window.addEventListener('pointermove', handleTouchGestureMove, { passive: false });
    window.addEventListener('pointerup', finishSliceDrag);
    window.addEventListener('pointerup', finishRenderCursorDrag);
    window.addEventListener('pointerup', finishPinchGesture);
    window.addEventListener('pointerup', finishTouchGesture);
    window.addEventListener('pointercancel', finishSliceDrag);
    window.addEventListener('pointercancel', finishRenderCursorDrag);
    window.addEventListener('pointercancel', finishPinchGesture);
    window.addEventListener('pointercancel', finishTouchGesture);

    const syncMultiplanarLayout = (): void => {
      viewer?.setMultiplanarLayout(
        mobileLayout.matches ? MULTIPLANAR_TYPE.GRID : MULTIPLANAR_TYPE.AUTO,
      );
      requestAnimationFrame(() => {
        syncRotationButtonPosition();
        syncGridCrosshairs();
      });
    };
    const blockCanvasCompatibilityEvent = (event: Event): void => {
      if (annotationTool() !== 'none' && isSinglePlane()) return;
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
    const blockNativeTouch = (event: TouchEvent): void => {
      if (annotationTool() !== 'none' || (!isSinglePlane() && activeView() !== 'render')) return;
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
    canvas?.addEventListener('touchstart', blockNativeTouch, { capture: true, passive: false });
    canvas?.addEventListener('touchmove', blockNativeTouch, { capture: true, passive: false });
    canvas?.addEventListener('touchend', blockNativeTouch, { capture: true, passive: false });
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
        forceDevicePixelRatio: 0.75,
        isClipPlanesCutaway: true,
        isResizeCanvas: true,
        loadingText: '',
        multiplanarShowRender: SHOW_RENDER.NEVER,
        multiplanarLayout: mobileLayout.matches ? MULTIPLANAR_TYPE.GRID : MULTIPLANAR_TYPE.AUTO,
        show3Dcrosshair: true,
      });
      await viewer.attachToCanvas(canvas, false);
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
        setVolumeDimensions([...volume.dimsRAS]);
        setDetails(volumeDetails(current.fileName, volume.hdr as NiftiHeader));
        const storedBitmap = await getUserLibraryMedicalAnnotationBitmap(props.documentId);
        const voxelCount = volume.dimsRAS.slice(1, 4).reduce((total, size) => total * size, 1);
        annotationBitmapLength = voxelCount;
        viewer.createEmptyDrawing();
        if (storedBitmap?.byteLength === voxelCount) viewer.drawBitmap = storedBitmap;
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
      window.removeEventListener('keydown', handleViewerShortcut);
      window.removeEventListener('pointermove', handleSliceDragMove);
      window.removeEventListener('pointermove', moveRenderCursor);
      window.removeEventListener('pointermove', handlePinchGestureMove);
      window.removeEventListener('pointermove', handleTouchGestureMove);
      window.removeEventListener('pointerup', finishSliceDrag);
      window.removeEventListener('pointerup', finishRenderCursorDrag);
      window.removeEventListener('pointerup', finishPinchGesture);
      window.removeEventListener('pointerup', finishTouchGesture);
      window.removeEventListener('pointercancel', finishSliceDrag);
      window.removeEventListener('pointercancel', finishRenderCursorDrag);
      window.removeEventListener('pointercancel', finishPinchGesture);
      window.removeEventListener('pointercancel', finishTouchGesture);
      canvas?.removeEventListener('pointerdown', beginCanvasDrag, true);
      canvas?.removeEventListener('touchstart', blockNativeTouch, true);
      canvas?.removeEventListener('touchmove', blockNativeTouch, true);
      canvas?.removeEventListener('touchend', blockNativeTouch, true);
      canvas?.removeEventListener('wheel', blockSliceWheelWhileAnnotating, true);
      layoutObserver.disconnect();
      mobileLayout.removeEventListener('change', syncMultiplanarLayout);
      if (sliceMoveFrame !== undefined) cancelAnimationFrame(sliceMoveFrame);
      if (contrastMoveFrame !== undefined) cancelAnimationFrame(contrastMoveFrame);
      if (pinchZoomFrame !== undefined) cancelAnimationFrame(pinchZoomFrame);
      if (renderCursorFrame !== undefined) cancelAnimationFrame(renderCursorFrame);
      sliceMoveFrame = undefined;
      contrastMoveFrame = undefined;
      pinchZoomFrame = undefined;
      renderCursorFrame = undefined;
      pendingSliceDelta = 0;
      pendingContrastPosition = undefined;
      pendingPinchZoomFactor = 1;
      pendingRenderCursorPosition = undefined;
      if (canvasInputReleaseTimer !== undefined) clearTimeout(canvasInputReleaseTimer);
      previousSliceRepeat.dispose();
      nextSliceRepeat.dispose();
      viewer?.cleanup();
      viewer = undefined;
    });
  });

  const tool = (
    view: VolumeView,
    modeLabel: string,
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
      aria-label={`Режим: ${modeLabel}`}
      title={`Режим: ${modeLabel}`}
      aria-pressed={activeView() === view}
      disabled={loading()}
      onClick={() => setView(view)}
      icon={<AppGlyph name={icon} class="medical-image-viewer__tool-icon" />}
    />
  );
  const showShortcuts = hasPhysicalKeyboard();

  return (
    <section
      class="medical-image-viewer medical-image-viewer--fullscreen"
      aria-label={`Медицинское изображение: ${props.title}`}
    >
      <MedicalImageViewerToolbar
        title={props.title}
        ariaLabel="Режим просмотра volume"
        loading={loading()}
        hasError={Boolean(error())}
        detailsOpen={detailsOpen()}
        showShortcuts={showShortcuts}
        onBack={props.onBack}
        onPrint={() => setPrintOpen(true)}
        onReset={resetView}
        onDetailsToggle={() => setDetailsOpen((open) => !open)}
        sliceNavigation={
          sliceAxis() !== null ? (
            <MedicalImageSliceNavigation
              indicator={
                <MedicalImageSliceIndicator
                  index={sliceIndex()}
                  count={sliceCount()}
                  disabled={!canDragSlice('indicator')}
                  onPointerDown={(event) => beginSliceDrag(event, 'indicator')}
                  onPointerMove={handleSliceDragMove}
                  onPointerUp={finishSliceDrag}
                  onPointerCancel={finishSliceDrag}
                  onKeyDown={handleSliceKeyDown}
                />
              }
              previousDisabled={loading() || annotationTool() !== 'none' || sliceIndex() <= 1}
              nextDisabled={
                loading() || annotationTool() !== 'none' || sliceIndex() >= sliceCount()
              }
              onPreviousStart={previousSliceRepeat.start}
              onPreviousStop={previousSliceRepeat.stop}
              onPrevious={previousSliceRepeat.activate}
              onNextStart={nextSliceRepeat.start}
              onNextStop={nextSliceRepeat.stop}
              onNext={nextSliceRepeat.activate}
            />
          ) : undefined
        }
      >
        <div class="medical-image-viewer__tool-group">
          {tool('multiplanar', 'все плоскости', 'squares-four')}
          {tool('render', '3D', 'cube')}
          {tool('axial', 'аксиальная плоскость (горизонтальный срез)', 'arrows-out-line-vertical')}
          {tool(
            'coronal',
            'корональная плоскость (вертикальный срез)',
            'arrows-out-line-horizontal',
          )}
          {tool('sagittal', 'сагиттальная плоскость', 'arrows-out-simple')}
        </div>
        <Show when={activeView() === 'render'}>
          <fieldset class="medical-image-viewer__tool-group">
            <legend class="medical-image-viewer__tool-group-label">Ось среза в 3D</legend>
            <Button
              class="medical-image-viewer__tool"
              variant="secondary"
              aria-label={`Режим: выбор оси среза ${VOLUME_AXIS_LABELS[renderSliceAxis()]}`}
              title="Режим: выбор оси среза; нажмите для смены оси"
              onClick={cycleRenderSliceAxis}
            >
              {VOLUME_AXIS_LABELS[renderSliceAxis()]}
            </Button>
          </fieldset>
        </Show>
        <fieldset class="medical-image-viewer__tool-group">
          <legend class="medical-image-viewer__tool-group-label">Настройка изображения</legend>
          <Button
            class="medical-image-viewer__tool medical-image-viewer__tool--icon"
            variant={contrastActive() ? 'primary' : 'secondary'}
            aria-label="Режим: настройка контраста (C)"
            title="Режим: настройка контраста (C)"
            aria-pressed={contrastActive()}
            disabled={loading() || activeView() === 'render'}
            onClick={toggleContrastTool}
            icon={
              <>
                <AppGlyph name="circle-half" class="medical-image-viewer__tool-icon" />
                <Show when={showShortcuts}>
                  <span class="medical-image-viewer__tool-shortcut" aria-hidden="true">
                    (c)
                  </span>
                </Show>
              </>
            }
          />
        </fieldset>
        <MedicalImageAnnotationToolbar
          tool={annotationTool()}
          color={annotationColor()}
          disabled={loading()}
          showShortcuts={showShortcuts}
          onToolChange={selectAnnotationTool}
          onColorChange={setAnnotationColor}
        />
      </MedicalImageViewerToolbar>
      <div
        class="medical-image-viewer__stage"
        ref={(element) => {
          stageElement = element;
        }}
      >
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
          aria-label={`Область просмотра: режим ${
            activeView() === 'multiplanar'
              ? 'все плоскости'
              : activeView() === 'render'
                ? '3D'
                : activeView() === 'axial'
                  ? 'аксиальный срез'
                  : activeView() === 'coronal'
                    ? 'корональный срез'
                    : 'сагиттальный срез'
          }`}
        />
        <Show when={activeView() === 'multiplanar' && gridCrosshairs().length > 0}>
          <div class="medical-image-viewer__grid-crosshairs" aria-hidden="true">
            <For each={gridCrosshairs()}>
              {(crosshair) => (
                <div
                  class="medical-image-viewer__grid-crosshair"
                  classList={{
                    [`medical-image-viewer__grid-crosshair--${crosshair.view}`]: true,
                  }}
                  style={{
                    left: `${String(crosshair.left)}px`,
                    top: `${String(crosshair.top)}px`,
                    width: `${String(crosshair.width)}px`,
                    height: `${String(crosshair.height)}px`,
                  }}
                >
                  <span
                    class="medical-image-viewer__grid-crosshair-line medical-image-viewer__grid-crosshair-line--vertical"
                    style={{ left: `${String(crosshair.x)}px` }}
                  />
                  <span
                    class="medical-image-viewer__grid-crosshair-line medical-image-viewer__grid-crosshair-line--horizontal"
                    style={{ top: `${String(crosshair.y)}px` }}
                  />
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={!loading() && !error() && rotationButtonPosition()}>
          {(position) => (
            <Button
              class="medical-image-viewer__tool medical-image-viewer__tool--icon medical-image-viewer__rotation-button"
              style={{ left: `${String(position()[0])}px`, top: `${String(position()[1])}px` }}
              variant={rotationActive() ? 'primary' : 'secondary'}
              aria-label="Режим: вращение 3D"
              title="Режим: вращение 3D"
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
      <MedicalImagePrintDialog
        open={printOpen()}
        documentId={props.documentId}
        title={props.title}
        directions={printDirections()}
        initialDirectionId={printDirectionForView()}
        capture={capturePrintFrames}
        onClose={() => setPrintOpen(false)}
      />
    </section>
  );
}
