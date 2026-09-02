import {
  Enums as CornerstoneEnums,
  type Types as CornerstoneTypes,
  cache,
  RenderingEngine,
} from '@cornerstonejs/core';
import {
  metaData as dicomMetaData,
  utilities as dicomUtilities,
  Enums as MetadataEnums,
} from '@cornerstonejs/metadata';
import {
  addTool,
  init as initCornerstoneTools,
  PanTool,
  StackScrollTool,
  Enums as ToolEnums,
  ToolGroupManager,
  WindowLevelTool,
  ZoomTool,
} from '@cornerstonejs/tools';
import dcmjs from 'dcmjs';
import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { initializeDicomRuntime } from '@/features/library/dicom-runtime';
import {
  MedicalImageAnnotationLayer,
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
  type MedicalImagePrintDetail as MedicalImageDetail,
  type MedicalImagePrintCaptureOptions,
  type MedicalImagePrintDirection,
  type MedicalImagePrintFrame,
  waitForMedicalImagePaint,
} from '@/features/library/medical-image-print';
import {
  createMedicalImagePressRepeat,
  medicalImageSliceDragSteps,
  readBlobWithProgress,
  withViewerTimeout,
} from '@/features/library/medical-image-utils';
import {
  getUserLibraryDocument,
  getUserLibraryFile,
  isUserLibraryDicomFile,
  listUserLibraryDocuments,
  type UserLibraryDocument,
  type UserLibraryMedicalAnnotationColor,
} from '@/state/user-library';
import '@/styles/dicom-viewer.css';

export { createDicomThumbnail } from './dicom-thumbnail';

interface DicomViewerProps {
  readonly documentId: string;
  readonly title: string;
  readonly onBack: () => void;
}

type ViewerTool = 'window' | 'pan' | 'zoom' | 'none';
type DicomTouchMode = 'slice' | 'window';

const TOUCH_SWIPE_THRESHOLD = 10;

interface DicomTouchGestureState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly target: HTMLElement;
  readonly mode: DicomTouchMode;
  currentX: number;
  currentY: number;
  appliedSteps: number;
  swiping: boolean;
}

interface DicomPinchGestureState {
  readonly pointerIds: readonly [number, number];
  readonly target: HTMLElement;
  firstX: number;
  firstY: number;
  secondX: number;
  secondY: number;
  lastDistance: number;
  lastMidpointX: number;
  lastMidpointY: number;
}

interface NaturalizedDicom {
  readonly PatientName?: unknown;
  readonly PatientBirthDate?: unknown;
  readonly StudyDate?: unknown;
  readonly StudyDescription?: unknown;
  readonly SeriesDescription?: unknown;
  readonly BodyPartExamined?: unknown;
  readonly AnatomicRegionSequence?: unknown;
  readonly PatientComments?: unknown;
  readonly AdditionalPatientHistory?: unknown;
  readonly ImageComments?: unknown;
  readonly SeriesInstanceUID?: unknown;
  readonly InstanceNumber?: unknown;
}

interface RegisteredDicom {
  readonly documentId: string;
  readonly baseImageId: string;
  readonly imageIds: readonly string[];
  readonly seriesUid: string;
  readonly instanceNumber: number;
  readonly details: readonly MedicalImageDetail[];
}

interface DicomSliceDragState {
  readonly pointerId: number;
  readonly startY: number;
  readonly target: HTMLElement;
  appliedSteps: number;
}

let cornerstoneInitialization: Promise<void> | undefined;

function initializeCornerstone(): Promise<void> {
  cornerstoneInitialization ??= initializeDicomRuntime().then(() => {
    dcmjs.log.getLogger('validation.dcmjs').setLevel('silent');
    initCornerstoneTools();
    addTool(WindowLevelTool);
    addTool(PanTool);
    addTool(ZoomTool);
    addTool(StackScrollTool);
  });
  return cornerstoneInitialization;
}

function scalarString(value: unknown): string {
  if (Array.isArray(value)) return scalarString(value[0]);
  if (value && typeof value === 'object' && 'Alphabetic' in value) {
    return scalarString((value as { readonly Alphabetic?: unknown }).Alphabetic).replaceAll(
      '^',
      ' ',
    );
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function dicomDate(value: unknown): string {
  const raw = scalarString(value);
  return /^\d{8}$/u.test(raw) ? `${raw.slice(6, 8)}.${raw.slice(4, 6)}.${raw.slice(0, 4)}` : raw;
}

function anatomicRegion(value: unknown): string {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first || typeof first !== 'object' || !('CodeMeaning' in first)) return '';
  return scalarString((first as { readonly CodeMeaning?: unknown }).CodeMeaning);
}

function localizedRegion(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    HEAD: 'Голова',
    CHEST: 'Грудная клетка',
    ABDOMEN: 'Брюшная полость',
    PELVIS: 'Таз',
    SPINE: 'Позвоночник',
    EXTREMITY: 'Конечность',
  };
  return labels[value.toUpperCase()] ?? value;
}

function dicomDetails(
  document: UserLibraryDocument,
  naturalized: NaturalizedDicom | undefined,
): readonly MedicalImageDetail[] {
  const region = localizedRegion(
    scalarString(naturalized?.BodyPartExamined) ||
      anatomicRegion(naturalized?.AnatomicRegionSequence),
  );
  return [
    { label: 'Файл', value: document.fileName },
    { label: 'Пациент', value: scalarString(naturalized?.PatientName) },
    { label: 'Дата рождения', value: dicomDate(naturalized?.PatientBirthDate) },
    { label: 'Дата исследования', value: dicomDate(naturalized?.StudyDate) },
    { label: 'Область', value: region },
    { label: 'Исследование', value: scalarString(naturalized?.StudyDescription), wide: true },
    { label: 'Серия', value: scalarString(naturalized?.SeriesDescription), wide: true },
    { label: 'Заметки', value: scalarString(naturalized?.PatientComments), wide: true },
    {
      label: 'Дополнительные сведения',
      value: scalarString(naturalized?.AdditionalPatientHistory),
      wide: true,
    },
    { label: 'Комментарий к снимку', value: scalarString(naturalized?.ImageComments), wide: true },
  ].filter((detail) => detail.value.trim().length > 0);
}

function scalarNumber(value: unknown): number {
  const parsed = Number(scalarString(value));
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function framesFor(baseImageId: string): readonly string[] {
  const frames = dicomMetaData.getTyped(
    MetadataEnums.MetadataModules.FRAME_IMAGE_IDS,
    baseImageId,
  ) as Set<string> | undefined;
  return frames && frames.size > 0 ? [...frames] : [baseImageId];
}

async function registerDicom(
  document: UserLibraryDocument,
  onProgress: (fraction: number) => void = () => undefined,
  signal?: AbortSignal,
): Promise<RegisteredDicom> {
  const blob = await getUserLibraryFile(document.id);
  if (!blob) throw new Error('Файл DICOM недоступен.');
  const baseImageId = `dicomfile:minimed-${document.id}`;
  await dicomUtilities.addDicomPart10Instance(
    baseImageId,
    await readBlobWithProgress(blob, onProgress, signal),
  );
  const naturalized = dicomMetaData.getTyped(
    MetadataEnums.MetadataModules.NATURALIZED,
    baseImageId,
  ) as NaturalizedDicom | undefined;
  return {
    documentId: document.id,
    baseImageId,
    imageIds: framesFor(baseImageId),
    seriesUid: scalarString(naturalized?.SeriesInstanceUID),
    instanceNumber: scalarNumber(naturalized?.InstanceNumber),
    details: dicomDetails(document, naturalized),
  };
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === 'object' && 'error' in cause) {
    return errorMessage((cause as { readonly error: unknown }).error);
  }
  return 'Не удалось прочитать DICOM-изображение.';
}

export default function DicomViewer(props: DicomViewerProps): JSX.Element {
  const [loading, setLoading] = createSignal(true);
  const [progress, setProgress] = createSignal(0);
  const [loadingText, setLoadingText] = createSignal('Подготавливаем DICOM…');
  const [error, setError] = createSignal<string | null>(null);
  const [activeTool, setActiveTool] = createSignal<ViewerTool>('none');
  const [sliceIndex, setSliceIndex] = createSignal(0);
  const [sliceCount, setSliceCount] = createSignal(0);
  const [details, setDetails] = createSignal<readonly MedicalImageDetail[]>([]);
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const [printOpen, setPrintOpen] = createSignal(false);
  const [annotationTool, setAnnotationTool] = createSignal<MedicalImageAnnotationTool>('none');
  const [annotationColor, setAnnotationColor] =
    createSignal<UserLibraryMedicalAnnotationColor>('red');
  let viewportElement: HTMLDivElement | undefined;
  let stageElement: HTMLDivElement | undefined;
  let viewport: CornerstoneTypes.IStackViewport | undefined;
  let toolGroup: ReturnType<typeof ToolGroupManager.createToolGroup>;
  let renderingEngine: RenderingEngine | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let sliceDrag: DicomSliceDragState | undefined;
  let registeredBaseImageIds: string[] = [];
  let imageIds: readonly string[] = [];
  let sliceMoveFrame: number | undefined;
  let pendingSliceIndex: number | undefined;
  let sliceMoveInFlight = false;
  let touchGesture: DicomTouchGestureState | undefined;
  let pinchGesture: DicomPinchGestureState | undefined;
  let pinchFrame: number | undefined;
  let pendingWindowDelta = { x: 0, y: 0 };
  let windowFrame: number | undefined;
  let seriesDiscoveryFrame: number | undefined;
  let seriesDiscoveryTimer: number | undefined;
  let printCaptureQueue: Promise<void> = Promise.resolve();
  let viewerDisposed = false;
  const uid = crypto.randomUUID();
  const renderingEngineId = `minimed-dicom-engine-${uid}`;
  const viewportId = `minimed-dicom-viewport-${uid}`;
  const toolGroupId = `minimed-dicom-tools-${uid}`;

  const syncSlice = (): void => {
    if (!viewport) return;
    setSliceIndex(viewport.getCurrentImageIdIndex() + 1);
    setSliceCount(viewport.getNumberOfSlices());
  };

  const setPrimaryTool = (next: ViewerTool): void => {
    if (!toolGroup) return;
    for (const candidate of [WindowLevelTool.toolName, PanTool.toolName, ZoomTool.toolName]) {
      toolGroup.setToolPassive(candidate);
    }
    if (next !== 'none') {
      const toolName =
        next === 'window'
          ? WindowLevelTool.toolName
          : next === 'pan'
            ? PanTool.toolName
            : ZoomTool.toolName;
      toolGroup.setToolActive(toolName, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
      });
    }
    setAnnotationTool('none');
    setActiveTool(next);
  };

  const setAnnotationMode = (next: MedicalImageAnnotationTool): void => {
    if (!toolGroup) return;
    if (next === 'none') {
      setPrimaryTool('none');
      return;
    }
    for (const candidate of [WindowLevelTool.toolName, PanTool.toolName, ZoomTool.toolName]) {
      toolGroup.setToolPassive(candidate);
    }
    setActiveTool('none');
    setAnnotationTool(next);
  };

  const flushSliceMove = (): void => {
    sliceMoveFrame = undefined;
    const next = pendingSliceIndex;
    pendingSliceIndex = undefined;
    if (!viewport || next === undefined) return;
    if (sliceMoveInFlight) {
      pendingSliceIndex = next;
      return;
    }
    if (next === viewport.getCurrentImageIdIndex()) return;
    sliceMoveInFlight = true;
    void viewport.setImageIdIndex(next).then(
      () => {
        sliceMoveInFlight = false;
        if (pendingSliceIndex !== undefined && sliceMoveFrame === undefined) {
          sliceMoveFrame = requestAnimationFrame(flushSliceMove);
        }
      },
      (cause: unknown) => {
        sliceMoveInFlight = false;
        if (!viewerDisposed) setError(errorMessage(cause));
        if (pendingSliceIndex !== undefined && sliceMoveFrame === undefined) {
          sliceMoveFrame = requestAnimationFrame(flushSliceMove);
        }
      },
    );
  };

  const moveSlice = (delta: number): void => {
    if (!viewport || imageIds.length < 2) return;
    const current = pendingSliceIndex ?? viewport.getCurrentImageIdIndex();
    const next = Math.min(imageIds.length - 1, Math.max(0, current + delta));
    if (next === current) return;
    pendingSliceIndex = next;
    if (sliceMoveInFlight || sliceMoveFrame !== undefined) return;
    sliceMoveFrame = requestAnimationFrame(flushSliceMove);
  };

  const previousSliceRepeat = createMedicalImagePressRepeat(
    () => moveSlice(-1),
    () => !loading() && sliceIndex() > 1,
  );
  const nextSliceRepeat = createMedicalImagePressRepeat(
    () => moveSlice(1),
    () => !loading() && sliceIndex() < sliceCount(),
  );

  const canDragSlice = (): boolean => !loading() && annotationTool() === 'none' && sliceCount() > 1;

  const finishSliceDrag = (event?: PointerEvent): void => {
    if (!sliceDrag || (event && event.pointerId !== sliceDrag.pointerId)) return;
    const completed = sliceDrag;
    sliceDrag = undefined;
    if (completed.target.hasPointerCapture(completed.pointerId)) {
      completed.target.releasePointerCapture(completed.pointerId);
    }
  };

  const beginSliceDrag = (event: PointerEvent): void => {
    if (
      !event.isPrimary ||
      (event.pointerType === 'mouse' && event.button !== 0) ||
      !canDragSlice()
    ) {
      return;
    }
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    sliceDrag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      target,
      appliedSteps: 0,
    };
  };

  const handleSliceDragMove = (event: PointerEvent): void => {
    if (!sliceDrag || event.pointerId !== sliceDrag.pointerId) return;
    if (!canDragSlice()) {
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

  const handleSliceKeyDown = (event: KeyboardEvent): void => {
    const delta =
      event.key === 'ArrowUp' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowDown' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    moveSlice(delta);
  };

  const resetView = (): void => {
    if (!viewport) return;
    viewport.resetProperties();
    viewport.resetCamera();
    viewport.render();
  };

  const printDirections = (): readonly MedicalImagePrintDirection[] => [
    {
      id: 'series',
      label: 'Серия DICOM',
      icon: 'film-strip',
      count: imageIds.length || sliceCount(),
      current: Math.max(1, sliceIndex()),
    },
  ];

  const capturePrintFrames = async (
    options: MedicalImagePrintCaptureOptions,
  ): Promise<readonly MedicalImagePrintFrame[]> => {
    const currentViewport = viewport;
    const currentStage = stageElement;
    if (!currentViewport || !currentStage || imageIds.length === 0) return [];

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

    const originalIndex = currentViewport.getCurrentImageIdIndex();
    const originalProperties = currentViewport.getProperties();
    const result: MedicalImagePrintFrame[] = [];
    const patient = details().find((detail) => detail.label === 'Пациент')?.value;
    const series = details().find((detail) => detail.label === 'Серия')?.value || props.title;

    try {
      for (const requestedSlice of options.slices) {
        if (options.signal?.aborted) return result;
        const index = Math.min(imageIds.length - 1, Math.max(0, requestedSlice - 1));
        await currentViewport.setImageIdIndex(index);
        await waitForMedicalImagePaint();
        if (options.signal?.aborted) return result;
        const captured = captureMedicalImageFrame(currentStage, options.includeAnnotations, () =>
          currentViewport.render(),
        );
        if (!captured) continue;
        const sliceLabel = `Срез ${String(index + 1)} из ${String(imageIds.length)}`;
        result.push({
          ...captured,
          directionLabel: 'DICOM',
          sliceLabel,
          ...(patient ? { patient } : {}),
          series,
          details: [...details(), { label: 'Срез', value: sliceLabel }],
        });
      }
    } finally {
      try {
        await currentViewport.setImageIdIndex(originalIndex);
        currentViewport.setProperties(originalProperties);
        currentViewport.render();
        syncSlice();
      } finally {
        releaseCapture?.();
      }
    }
    return result;
  };

  const scheduleWindowLevel = (deltaX: number, deltaY: number): void => {
    pendingWindowDelta.x += deltaX;
    pendingWindowDelta.y += deltaY;
    if (windowFrame !== undefined) return;
    windowFrame = requestAnimationFrame(() => {
      windowFrame = undefined;
      const delta = pendingWindowDelta;
      pendingWindowDelta = { x: 0, y: 0 };
      if (!viewport || (delta.x === 0 && delta.y === 0)) return;
      const { lower, upper } = viewport.getProperties().voiRange ?? { lower: 0, upper: 1 };
      const width = Math.max(1, upper - lower) + delta.x * 4;
      const center = (upper + lower) / 2 + delta.y * 4;
      const nextWidth = Math.max(1, width);
      viewport.setProperties({
        voiRange: {
          lower: center - nextWidth / 2,
          upper: center + nextWidth / 2,
        },
      });
      viewport.render();
    });
  };

  const flushPinch = (): void => {
    pinchFrame = undefined;
    const pinch = pinchGesture;
    if (!viewport || !pinch) return;
    const distance = Math.hypot(pinch.secondX - pinch.firstX, pinch.secondY - pinch.firstY);
    const midpointX = (pinch.firstX + pinch.secondX) / 2;
    const midpointY = (pinch.firstY + pinch.secondY) / 2;
    const zoomFactor = pinch.lastDistance > 0 ? distance / pinch.lastDistance : 1;
    const pan = viewport.getPan();
    viewport.setPan([
      pan[0] + midpointX - pinch.lastMidpointX,
      pan[1] + midpointY - pinch.lastMidpointY,
    ]);
    if (zoomFactor > 0 && zoomFactor !== 1) viewport.setZoom(viewport.getZoom() * zoomFactor);
    viewport.render();
    pinch.lastDistance = distance;
    pinch.lastMidpointX = midpointX;
    pinch.lastMidpointY = midpointY;
  };

  const schedulePinch = (): void => {
    if (pinchFrame !== undefined) return;
    pinchFrame = requestAnimationFrame(flushPinch);
  };

  const handlePinchMove = (event: PointerEvent): void => {
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
    schedulePinch();
  };

  const finishPinch = (event?: PointerEvent): void => {
    const pinch = pinchGesture;
    if (!pinch || (event && !pinch.pointerIds.includes(event.pointerId))) return;
    event?.preventDefault();
    flushPinch();
    for (const pointerId of pinch.pointerIds) {
      if (pinch.target.hasPointerCapture(pointerId)) pinch.target.releasePointerCapture(pointerId);
    }
    pinchGesture = undefined;
    touchGesture = undefined;
  };

  const beginTouchGesture = (event: PointerEvent): boolean => {
    if (
      !viewportElement ||
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
      const midpointX = (existing.currentX + event.clientX) / 2;
      const midpointY = (existing.currentY + event.clientY) / 2;
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
        lastMidpointX: midpointX,
        lastMidpointY: midpointY,
      };
      touchGesture = undefined;
      pendingWindowDelta = { x: 0, y: 0 };
      return true;
    }
    if (!event.isPrimary) return false;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    touchGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      target,
      mode: activeTool() === 'window' ? 'window' : 'slice',
      currentX: event.clientX,
      currentY: event.clientY,
      appliedSteps: 0,
      swiping: false,
    };
    return true;
  };

  const handleTouchMove = (event: PointerEvent): void => {
    const gesture = touchGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const deltaX = event.clientX - gesture.currentX;
    const deltaY = event.clientY - gesture.currentY;
    gesture.currentX = event.clientX;
    gesture.currentY = event.clientY;
    const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
    if (!gesture.swiping) {
      if (distance < TOUCH_SWIPE_THRESHOLD) return;
      gesture.swiping = true;
    }
    event.preventDefault();
    if (gesture.mode === 'window') {
      scheduleWindowLevel(deltaX, deltaY);
      return;
    }
    const pixelsPerStep = Math.max(2, Math.min(12, window.innerHeight / (sliceCount() - 1)));
    const steps = medicalImageSliceDragSteps(gesture.startY, event.clientY, pixelsPerStep);
    const delta = steps - gesture.appliedSteps;
    if (delta === 0) return;
    gesture.appliedSteps = steps;
    moveSlice(delta);
  };

  const finishTouchGesture = (event?: PointerEvent): void => {
    const gesture = touchGesture;
    if (!gesture || (event && event.pointerId !== gesture.pointerId)) return;
    event?.preventDefault();
    touchGesture = undefined;
    if (gesture.target.hasPointerCapture(gesture.pointerId)) {
      gesture.target.releasePointerCapture(gesture.pointerId);
    }
  };

  const handleViewerShortcut = (event: KeyboardEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'r') resetView();
    else if (key === 'i') setDetailsOpen((open) => !open);
    else if (key === 'backspace') props.onBack();
    else if (key === 'c') setPrimaryTool('window');
    else if (key === 'p') setPrimaryTool('pan');
    else if (key === 'z') setPrimaryTool('zoom');
    else if (key === 'd') setAnnotationMode('pen');
    else if (key === 'e') setAnnotationMode('eraser');
    else return;
    event.preventDefault();
  };

  onMount(() => {
    let cancelled = false;
    const abortController = new AbortController();
    const blockNativeTouch = (event: TouchEvent): void => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('pointermove', handleTouchMove, { passive: false });
    window.addEventListener('pointermove', handlePinchMove, { passive: false });
    window.addEventListener('keydown', handleViewerShortcut);
    window.addEventListener('pointerup', finishPinch);
    window.addEventListener('pointerup', finishTouchGesture);
    window.addEventListener('pointercancel', finishPinch);
    window.addEventListener('pointercancel', finishTouchGesture);

    const open = async (): Promise<void> => {
      if (!viewportElement) return;
      setProgress(0.05);
      await initializeCornerstone();
      setProgress(0.14);
      const current = await getUserLibraryDocument(props.documentId);
      if (!current) throw new Error('Файл DICOM больше недоступен.');

      setLoadingText('Читаем DICOM…');
      const registeredCurrent = await registerDicom(
        current,
        (fraction) => setProgress(0.14 + fraction * 0.46),
        abortController.signal,
      );
      registeredBaseImageIds = [registeredCurrent.baseImageId];
      setDetails(registeredCurrent.details);
      const registered: RegisteredDicom[] = [registeredCurrent];
      if (cancelled) return;
      imageIds = registeredCurrent.imageIds;

      renderingEngine = new RenderingEngine(renderingEngineId);
      renderingEngine.enableElement({
        viewportId,
        type: CornerstoneEnums.ViewportType.STACK,
        element: viewportElement,
        defaultOptions: { background: [0.02, 0.025, 0.03] },
      });
      viewport = renderingEngine.getViewport<CornerstoneTypes.IStackViewport>(viewportId);
      toolGroup = ToolGroupManager.createToolGroup(toolGroupId);
      if (!toolGroup) throw new Error('Не удалось создать инструменты DICOM-ридера.');
      for (const toolName of [
        WindowLevelTool.toolName,
        PanTool.toolName,
        ZoomTool.toolName,
        StackScrollTool.toolName,
      ]) {
        toolGroup.addTool(toolName);
      }
      toolGroup.addViewport(viewportId, renderingEngineId);
      toolGroup.setToolActive(StackScrollTool.toolName, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Wheel }],
      });
      setPrimaryTool('none');

      viewportElement.addEventListener(CornerstoneEnums.Events.STACK_NEW_IMAGE, syncSlice);
      viewportElement.addEventListener('pointerdown', beginTouchGesture, true);
      viewportElement.addEventListener('touchstart', blockNativeTouch, {
        capture: true,
        passive: false,
      });
      viewportElement.addEventListener('touchmove', blockNativeTouch, {
        capture: true,
        passive: false,
      });
      viewportElement.addEventListener('touchend', blockNativeTouch, {
        capture: true,
        passive: false,
      });
      viewportElement.addEventListener('touchcancel', blockNativeTouch, {
        capture: true,
        passive: false,
      });
      setLoadingText('Декодируем первый срез…');
      setProgress(0.72);
      await withViewerTimeout(
        viewport.setStack([...imageIds], 0),
        'DICOM decoder не ответил за 30 секунд.',
      );
      viewport.render();
      syncSlice();
      resizeObserver = new ResizeObserver(() => renderingEngine?.resize(true, false));
      resizeObserver.observe(viewportElement);
      setProgress(1);
      setLoading(false);

      if (!registeredCurrent.seriesUid) return;
      const discoverSeries = async (): Promise<void> => {
        try {
          const siblings = (await listUserLibraryDocuments()).filter(
            (document) =>
              document.id !== current.id &&
              (document.folderId ?? null) === (current.folderId ?? null) &&
              isUserLibraryDicomFile(document.mimeType, document.fileName),
          );
          for (const sibling of siblings) {
            if (cancelled) return;
            try {
              const candidate = await registerDicom(
                sibling,
                () => undefined,
                abortController.signal,
              );
              if (cancelled) {
                dicomMetaData.clearQuery(
                  MetadataEnums.MetadataModules.NATURALIZED,
                  candidate.baseImageId,
                );
                return;
              }
              registeredBaseImageIds.push(candidate.baseImageId);
              if (candidate.seriesUid === registeredCurrent.seriesUid) registered.push(candidate);
            } catch {
              // A damaged sibling must not prevent the selected, valid image from opening.
            }
          }
          if (cancelled || registered.length === 1) return;
          registered.sort(
            (left, right) =>
              left.instanceNumber - right.instanceNumber ||
              left.documentId.localeCompare(right.documentId),
          );
          imageIds = registered.flatMap((entry) => entry.imageIds);
          const initialIndex = Math.max(
            0,
            registered
              .slice(
                0,
                registered.findIndex((entry) => entry.documentId === current.id),
              )
              .reduce((count, entry) => count + entry.imageIds.length, 0),
          );
          const currentViewport = viewport;
          if (!currentViewport) return;
          await currentViewport.setStack([...imageIds], initialIndex);
          if (!cancelled) {
            currentViewport.render();
            syncSlice();
          }
        } catch {
          // Series discovery is optional after the selected image has rendered.
        }
      };
      seriesDiscoveryFrame = requestAnimationFrame(() => {
        seriesDiscoveryFrame = undefined;
        seriesDiscoveryTimer = window.setTimeout(() => {
          seriesDiscoveryTimer = undefined;
          void discoverSeries();
        }, 0);
      });
    };

    void open().catch((cause: unknown) => {
      if (!cancelled) {
        setError(errorMessage(cause));
        setLoading(false);
      }
    });

    onCleanup(() => {
      cancelled = true;
      viewerDisposed = true;
      abortController.abort();
      if (sliceMoveFrame !== undefined) cancelAnimationFrame(sliceMoveFrame);
      if (pinchFrame !== undefined) cancelAnimationFrame(pinchFrame);
      if (windowFrame !== undefined) cancelAnimationFrame(windowFrame);
      if (seriesDiscoveryFrame !== undefined) cancelAnimationFrame(seriesDiscoveryFrame);
      if (seriesDiscoveryTimer !== undefined) window.clearTimeout(seriesDiscoveryTimer);
      window.removeEventListener('pointermove', handleTouchMove);
      window.removeEventListener('pointermove', handlePinchMove);
      window.removeEventListener('keydown', handleViewerShortcut);
      window.removeEventListener('pointerup', finishPinch);
      window.removeEventListener('pointerup', finishTouchGesture);
      window.removeEventListener('pointercancel', finishPinch);
      window.removeEventListener('pointercancel', finishTouchGesture);
      sliceMoveFrame = undefined;
      pendingSliceIndex = undefined;
      pinchFrame = undefined;
      windowFrame = undefined;
      seriesDiscoveryFrame = undefined;
      seriesDiscoveryTimer = undefined;
      resizeObserver?.disconnect();
      previousSliceRepeat.dispose();
      nextSliceRepeat.dispose();
      viewportElement?.removeEventListener(CornerstoneEnums.Events.STACK_NEW_IMAGE, syncSlice);
      viewportElement?.removeEventListener('pointerdown', beginTouchGesture, true);
      viewportElement?.removeEventListener('touchstart', blockNativeTouch, true);
      viewportElement?.removeEventListener('touchmove', blockNativeTouch, true);
      viewportElement?.removeEventListener('touchend', blockNativeTouch, true);
      viewportElement?.removeEventListener('touchcancel', blockNativeTouch, true);
      ToolGroupManager.destroyToolGroup(toolGroupId);
      renderingEngine?.destroy();
      for (const imageId of imageIds) {
        if (cache.getImageLoadObject(imageId))
          cache.removeImageLoadObject(imageId, { force: true });
      }
      for (const baseImageId of registeredBaseImageIds) {
        dicomMetaData.clearQuery(MetadataEnums.MetadataModules.NATURALIZED, baseImageId);
      }
    });
  });

  const toolIcon = (name: AppGlyphName): JSX.Element => (
    <AppGlyph name={name} class="medical-image-viewer__tool-icon" />
  );
  const showShortcuts = hasPhysicalKeyboard();

  return (
    <section
      class="medical-image-viewer medical-image-viewer--fullscreen"
      aria-label={`DICOM: ${props.title}`}
    >
      <MedicalImageViewerToolbar
        title={props.title}
        ariaLabel="Инструменты DICOM"
        loading={loading()}
        hasError={Boolean(error())}
        detailsOpen={detailsOpen()}
        showShortcuts={showShortcuts}
        onBack={props.onBack}
        onPrint={() => setPrintOpen(true)}
        onReset={resetView}
        onDetailsToggle={() => setDetailsOpen((open) => !open)}
        sliceNavigation={
          <MedicalImageSliceNavigation
            indicator={
              <MedicalImageSliceIndicator
                index={sliceIndex()}
                count={sliceCount()}
                disabled={!canDragSlice()}
                onPointerDown={beginSliceDrag}
                onPointerMove={handleSliceDragMove}
                onPointerUp={finishSliceDrag}
                onPointerCancel={finishSliceDrag}
                onKeyDown={handleSliceKeyDown}
              />
            }
            previousDisabled={loading() || sliceIndex() <= 1}
            nextDisabled={loading() || sliceIndex() >= sliceCount()}
            onPreviousStart={previousSliceRepeat.start}
            onPreviousStop={previousSliceRepeat.stop}
            onPrevious={previousSliceRepeat.activate}
            onNextStart={nextSliceRepeat.start}
            onNextStop={nextSliceRepeat.stop}
            onNext={nextSliceRepeat.activate}
          />
        }
      >
        <fieldset class="medical-image-viewer__tool-group">
          <legend class="medical-image-viewer__tool-group-label">Режим указателя</legend>
          <Button
            class="medical-image-viewer__tool medical-image-viewer__tool--shortcut"
            variant={activeTool() === 'window' ? 'primary' : 'secondary'}
            aria-label="Режим: настройка контраста (C)"
            title="Режим: настройка контраста (C)"
            aria-pressed={activeTool() === 'window'}
            onClick={() => setPrimaryTool('window')}
            icon={
              <>
                {toolIcon('circle-half')}
                <Show when={showShortcuts}>
                  <span class="medical-image-viewer__tool-shortcut" aria-hidden="true">
                    (c)
                  </span>
                </Show>
              </>
            }
          >
            Контраст
          </Button>
          <Button
            class="medical-image-viewer__tool medical-image-viewer__tool--shortcut"
            variant={activeTool() === 'pan' ? 'primary' : 'secondary'}
            aria-label="Режим: перемещение изображения (P)"
            title="Режим: перемещение изображения (P)"
            aria-pressed={activeTool() === 'pan'}
            onClick={() => setPrimaryTool('pan')}
            icon={
              <>
                {toolIcon('hand')}
                <Show when={showShortcuts}>
                  <span class="medical-image-viewer__tool-shortcut" aria-hidden="true">
                    (p)
                  </span>
                </Show>
              </>
            }
          >
            Перемещение
          </Button>
          <Button
            class="medical-image-viewer__tool medical-image-viewer__tool--shortcut"
            variant={activeTool() === 'zoom' ? 'primary' : 'secondary'}
            aria-label="Режим: масштаб изображения (Z)"
            title="Режим: масштаб изображения (Z)"
            aria-pressed={activeTool() === 'zoom'}
            onClick={() => setPrimaryTool('zoom')}
            icon={
              <>
                {toolIcon('magnifying-glass-plus')}
                <Show when={showShortcuts}>
                  <span class="medical-image-viewer__tool-shortcut" aria-hidden="true">
                    (z)
                  </span>
                </Show>
              </>
            }
          >
            Масштаб
          </Button>
        </fieldset>
        <MedicalImageAnnotationToolbar
          tool={annotationTool()}
          color={annotationColor()}
          disabled={loading()}
          showShortcuts={showShortcuts}
          onToolChange={setAnnotationMode}
          onColorChange={setAnnotationColor}
        />
      </MedicalImageViewerToolbar>
      <div
        class="medical-image-viewer__stage"
        ref={(element) => {
          stageElement = element;
        }}
      >
        <div
          ref={(element) => {
            viewportElement = element;
          }}
          class="medical-image-viewer__viewport"
          role="application"
          aria-label={`Область просмотра DICOM: режим ${
            activeTool() === 'window'
              ? 'настройка контраста'
              : activeTool() === 'pan'
                ? 'перемещение'
                : activeTool() === 'zoom'
                  ? 'масштаб'
                  : 'смена срезов'
          }`}
          onContextMenu={(event) => event.preventDefault()}
        />
        <MedicalImageAnnotationLayer
          documentId={props.documentId}
          sliceKey={sliceIndex() > 0 ? `dicom:${String(sliceIndex())}` : null}
          tool={annotationTool()}
          color={annotationColor()}
          disabled={loading()}
        />
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
        initialDirectionId="series"
        capture={capturePrintFrames}
        onClose={() => setPrintOpen(false)}
      />
    </section>
  );
}
