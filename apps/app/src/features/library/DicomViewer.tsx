import {
  Enums as CornerstoneEnums,
  type Types as CornerstoneTypes,
  cache,
  imageLoader,
  init as initCornerstone,
  RenderingEngine,
} from '@cornerstonejs/core';
import { init as initDicomImageLoader } from '@cornerstonejs/dicom-image-loader';
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
import {
  MedicalImageAnnotationLayer,
  type MedicalImageAnnotationTool,
  MedicalImageAnnotationToolbar,
} from '@/features/library/MedicalImageAnnotations';
import { MedicalImageTitle } from '@/features/library/MedicalImageTitle';
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

interface DicomViewerProps {
  readonly documentId: string;
  readonly title: string;
  readonly onBack: () => void;
}

type ViewerTool = 'window' | 'pan' | 'zoom' | 'none';

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

interface MedicalImageDetail {
  readonly label: string;
  readonly value: string;
  readonly wide?: boolean;
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
  cornerstoneInitialization ??= Promise.resolve().then(() => {
    dcmjs.log.getLogger('validation.dcmjs').setLevel('silent');
    initCornerstone();
    initDicomImageLoader({
      maxWebWorkers: Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2))),
      wasmBasePath: new URL('cornerstone-codecs', document.baseURI).toString(),
    });
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

function thumbnailCanvas(image: CornerstoneTypes.IImage): string | undefined {
  const width = image.width;
  const height = image.height;
  const pixels = image.getPixelData();
  if (!width || !height || !pixels?.length) return undefined;
  const maxEdge = 320;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  const frame = context.createImageData(targetWidth, targetHeight);
  const center = Number(
    Array.isArray(image.windowCenter) ? image.windowCenter[0] : image.windowCenter,
  );
  const windowWidth = Number(
    Array.isArray(image.windowWidth) ? image.windowWidth[0] : image.windowWidth,
  );
  const minimum = Number.isFinite(image.minPixelValue) ? image.minPixelValue : 0;
  const maximum = Number.isFinite(image.maxPixelValue) ? image.maxPixelValue : minimum + 1;
  const low = Number.isFinite(center) && windowWidth > 0 ? center - windowWidth / 2 : minimum;
  const high = Number.isFinite(center) && windowWidth > 0 ? center + windowWidth / 2 : maximum;
  const range = Math.max(1, high - low);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(x / scale));
      const value = Number(pixels[sourceY * width + sourceX]);
      const gray = Math.round(Math.min(255, Math.max(0, ((value - low) / range) * 255)));
      const output = image.invert ? 255 - gray : gray;
      const offset = (y * targetWidth + x) * 4;
      frame.data[offset] = output;
      frame.data[offset + 1] = output;
      frame.data[offset + 2] = output;
      frame.data[offset + 3] = 255;
    }
  }
  context.putImageData(frame, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.76);
}

export async function createDicomThumbnail(blob: Blob): Promise<string | undefined> {
  await initializeCornerstone();
  const baseImageId = `dicomfile:minimed-thumbnail-${crypto.randomUUID()}`;
  let imageId = baseImageId;
  try {
    await dicomUtilities.addDicomPart10Instance(baseImageId, await blob.arrayBuffer());
    imageId = framesFor(baseImageId)[0] ?? baseImageId;
    const image = await withViewerTimeout(
      imageLoader.loadAndCacheImage(imageId),
      'Превью DICOM создаётся слишком долго.',
    );
    return thumbnailCanvas(image);
  } catch {
    return undefined;
  } finally {
    if (cache.getImageLoadObject(imageId)) cache.removeImageLoadObject(imageId, { force: true });
    dicomMetaData.clearQuery(MetadataEnums.MetadataModules.NATURALIZED, baseImageId);
  }
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
  const [activeTool, setActiveTool] = createSignal<ViewerTool>('window');
  const [sliceIndex, setSliceIndex] = createSignal(0);
  const [sliceCount, setSliceCount] = createSignal(0);
  const [details, setDetails] = createSignal<readonly MedicalImageDetail[]>([]);
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const [annotationTool, setAnnotationTool] = createSignal<MedicalImageAnnotationTool>('none');
  const [annotationColor, setAnnotationColor] =
    createSignal<UserLibraryMedicalAnnotationColor>('red');
  let viewportElement: HTMLDivElement | undefined;
  let viewport: CornerstoneTypes.IStackViewport | undefined;
  let toolGroup: ReturnType<typeof ToolGroupManager.createToolGroup>;
  let renderingEngine: RenderingEngine | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let sliceDrag: DicomSliceDragState | undefined;
  let registeredBaseImageIds: string[] = [];
  let imageIds: readonly string[] = [];
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
    if (!toolGroup || next === 'none') return;
    const toolName =
      next === 'window'
        ? WindowLevelTool.toolName
        : next === 'pan'
          ? PanTool.toolName
          : ZoomTool.toolName;
    for (const candidate of [WindowLevelTool.toolName, PanTool.toolName, ZoomTool.toolName]) {
      toolGroup.setToolPassive(candidate);
    }
    toolGroup.setToolActive(toolName, {
      bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
    });
    setAnnotationTool('none');
    setActiveTool(next);
  };

  const setAnnotationMode = (next: MedicalImageAnnotationTool): void => {
    if (!toolGroup) return;
    if (next === 'none') {
      setPrimaryTool('window');
      return;
    }
    for (const candidate of [WindowLevelTool.toolName, PanTool.toolName, ZoomTool.toolName]) {
      toolGroup.setToolPassive(candidate);
    }
    setActiveTool('none');
    setAnnotationTool(next);
  };

  const moveSlice = (delta: number): void => {
    if (!viewport || imageIds.length < 2) return;
    const next = Math.min(
      imageIds.length - 1,
      Math.max(0, viewport.getCurrentImageIdIndex() + delta),
    );
    if (next !== viewport.getCurrentImageIdIndex()) void viewport.setImageIdIndex(next);
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

  onMount(() => {
    let cancelled = false;
    const abortController = new AbortController();

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
      setPrimaryTool('window');

      viewportElement.addEventListener(CornerstoneEnums.Events.STACK_NEW_IMAGE, syncSlice);
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
            const candidate = await registerDicom(sibling);
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
        await viewport.setStack([...imageIds], initialIndex);
        if (!cancelled) {
          viewport.render();
          syncSlice();
        }
      } catch {
        // Series discovery is optional after the selected image has rendered.
      }
    };

    void open().catch((cause: unknown) => {
      if (!cancelled) {
        setError(errorMessage(cause));
        setLoading(false);
      }
    });

    onCleanup(() => {
      cancelled = true;
      abortController.abort();
      resizeObserver?.disconnect();
      previousSliceRepeat.dispose();
      nextSliceRepeat.dispose();
      viewportElement?.removeEventListener(CornerstoneEnums.Events.STACK_NEW_IMAGE, syncSlice);
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

  return (
    <section
      class="medical-image-viewer medical-image-viewer--fullscreen"
      aria-label={`DICOM: ${props.title}`}
    >
      <nav class="medical-image-viewer__toolbar" aria-label="Инструменты DICOM">
        <div class="medical-image-viewer__toolbar-locked medical-image-viewer__toolbar-locked--leading">
          <Button
            class="medical-image-viewer__tool medical-image-viewer__tool--icon"
            variant="icon"
            aria-label="Назад"
            title="Назад"
            onClick={props.onBack}
            icon={toolIcon('arrow-left')}
          />
          <MedicalImageTitle title={props.title} />
        </div>
        <div class="medical-image-viewer__toolbar-scroll">
          <div class="medical-image-viewer__toolbar-scroll-content">
            <fieldset class="medical-image-viewer__tool-group">
              <legend class="medical-image-viewer__tool-group-label">Режим указателя</legend>
              <Button
                class="medical-image-viewer__tool"
                variant={activeTool() === 'window' ? 'primary' : 'secondary'}
                aria-pressed={activeTool() === 'window'}
                onClick={() => setPrimaryTool('window')}
                icon={toolIcon('circle-half')}
              >
                Контраст
              </Button>
              <Button
                class="medical-image-viewer__tool"
                variant={activeTool() === 'pan' ? 'primary' : 'secondary'}
                aria-pressed={activeTool() === 'pan'}
                onClick={() => setPrimaryTool('pan')}
                icon={toolIcon('hand')}
              >
                Перемещение
              </Button>
              <Button
                class="medical-image-viewer__tool"
                variant={activeTool() === 'zoom' ? 'primary' : 'secondary'}
                aria-pressed={activeTool() === 'zoom'}
                onClick={() => setPrimaryTool('zoom')}
                icon={toolIcon('magnifying-glass-plus')}
              >
                Масштаб
              </Button>
            </fieldset>
            <MedicalImageAnnotationToolbar
              tool={annotationTool()}
              color={annotationColor()}
              disabled={loading()}
              onToolChange={setAnnotationMode}
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
            icon={toolIcon('arrow-counter-clockwise')}
          />
          <Button
            class="medical-image-viewer__tool medical-image-viewer__tool--icon"
            variant={detailsOpen() ? 'primary' : 'icon'}
            aria-label="Информация об исследовании"
            title="Информация об исследовании"
            aria-pressed={detailsOpen()}
            aria-expanded={detailsOpen()}
            onClick={() => setDetailsOpen((open) => !open)}
            icon={toolIcon('info')}
          />
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
              disabled={loading() || sliceIndex() <= 1}
              onPointerDown={previousSliceRepeat.start}
              onPointerUp={previousSliceRepeat.stop}
              onPointerCancel={previousSliceRepeat.stop}
              onPointerLeave={previousSliceRepeat.stop}
              onClick={previousSliceRepeat.activate}
              icon={toolIcon('caret-left')}
            />
            <span
              class="medical-image-viewer__slice"
              role="slider"
              tabIndex={annotationTool() === 'none' ? 0 : -1}
              aria-label="Номер среза"
              aria-disabled={!canDragSlice()}
              aria-orientation="vertical"
              aria-valuemin={1}
              aria-valuemax={Math.max(1, sliceCount())}
              aria-valuenow={Math.max(1, sliceIndex())}
              aria-valuetext={`${String(sliceIndex())} из ${String(sliceCount())}`}
              onPointerDown={beginSliceDrag}
              onPointerMove={handleSliceDragMove}
              onPointerUp={finishSliceDrag}
              onPointerCancel={finishSliceDrag}
              onKeyDown={handleSliceKeyDown}
            >
              {sliceCount() > 0 ? `${String(sliceIndex())} / ${String(sliceCount())}` : '— / —'}
            </span>
            <Button
              class="medical-image-viewer__tool medical-image-viewer__tool--icon"
              variant="icon"
              aria-label="Следующий срез"
              title="Следующий срез"
              disabled={loading() || sliceIndex() >= sliceCount()}
              onPointerDown={nextSliceRepeat.start}
              onPointerUp={nextSliceRepeat.stop}
              onPointerCancel={nextSliceRepeat.stop}
              onPointerLeave={nextSliceRepeat.stop}
              onClick={nextSliceRepeat.activate}
              icon={toolIcon('caret-right')}
            />
          </fieldset>
        </div>
      </nav>
      <div class="medical-image-viewer__stage">
        <div
          ref={(element) => {
            viewportElement = element;
          }}
          class="medical-image-viewer__viewport"
          role="application"
          aria-label="Область просмотра DICOM"
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
    </section>
  );
}
