import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import ecgPhotoExample from '@/assets/ecg-photo-example.jpg';
import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import { EcgDigitizedWaveformReview } from '@/features/calculators/EcgDigitizedWaveformReview';
import { EcgNumericDiagnosticPanel } from '@/features/calculators/EcgNumericDiagnosticPanel';
import { EcgPerspectiveEditor } from '@/features/calculators/EcgPerspectiveEditor';
import {
  digitizeEcgPhoto,
  ECG_MODEL_CATALOG,
  type EcgModelDescriptor,
  installEcgModelFromCatalog,
  readEcgModelDescriptor,
  subscribeEcgModel,
} from '@/features/calculators/ecg-model';
import type {
  EcgDigitizationResult,
  EcgPhotoCorners,
} from '@/features/calculators/ecg-model-contract';
import {
  ECG_DIAGNOSTIC_MODEL_CATALOG,
  type EcgDiagnosticModelDescriptor,
  installEcgDiagnosticModelFromCatalog,
  readEcgDiagnosticModelDescriptor,
  subscribeEcgDiagnosticModel,
} from '@/features/calculators/ecg-numeric-diagnostic';
import type { EcgPatientRoute } from '@/features/calculators/ecg-patient-age';
import {
  calculateEcgMeasurements,
  ECG_MILLISECONDS_PER_MILLIMETER,
  ECG_PAPER_SPEED_MM_PER_SECOND,
  ECG_SENSITIVITY_MM_PER_MILLIVOLT,
  type EcgIntervalId,
  type EcgMeasurements,
  type EcgPointPair,
  rescaleEcgPointPair,
  shiftEcgPointPair,
} from '@/features/calculators/ecg-photo-caliper';
import {
  ECG_MIN_IMAGE_HEIGHT_PX,
  ECG_MIN_IMAGE_WIDTH_PX,
  type EcgMorphologyObservations,
  type EcgObservationState,
  interpretEcgPhoto,
} from '@/features/calculators/ecg-photo-interpreter';
import { createRectifiedEcgPhotoPreview } from '@/features/calculators/ecg-photo-rectification';
import {
  canAcceptEcgAutomaticDraft,
  ecgAmplitudeSuggestions,
  ecgIntervalSuggestions,
} from '@/features/calculators/ecg-waveform-measurements';
import { usePinchZoom } from '@/features/library/use-pinch-zoom';
import { rememberReturnTo } from '@/state/return-navigation';
import '@/styles/ecg-photo-caliper.css';

type CaliperMode = 'calibration' | EcgIntervalId;
type CaliperDragKind = 'new' | 'start' | 'end' | 'range';

interface CaliperDrag {
  readonly kind: CaliperDragKind;
  readonly pointerId: number;
  readonly originX: number;
  readonly initialPair: EcgPointPair | undefined;
}

const INTERVALS: readonly {
  readonly id: EcgIntervalId;
  readonly label: string;
}[] = [
  { id: 'rr', label: 'RR' },
  { id: 'p', label: 'P' },
  { id: 'pr', label: 'PR' },
  { id: 'qrs', label: 'QRS' },
  { id: 'qt', label: 'QT' },
];

const MANUAL_INSTRUCTIONS: Record<CaliperMode, string> = {
  calibration:
    'Найдите участок чистой сетки и протяните диапазон ровно на 5 больших клеток (25 мм).',
  rr: 'На длинной ритм-строке II протяните диапазон от вершины одного R до вершины следующего R.',
  p: 'На хорошо видимом зубце P отметьте расстояние от первого отклонения от изолинии до возвращения к ней.',
  pr: 'На одном комплексе отметьте расстояние от начала P до самого раннего начала QRS.',
  qrs: 'Отметьте расстояние от самого раннего начала Q/R до самого позднего окончания S.',
  qt: 'Отметьте расстояние от начала QRS до конца T; конец T выбирайте по касательной к нисходящей части.',
};

const INTERPRETATION_STATUS_LABELS = {
  'requires-review': 'Недостаточно измерений для полной проверки',
  normal: 'По измеренным параметрам отклонений по этим порогам нет',
  finding: 'Есть признаки, требующие врачебной оценки',
  'urgent-review': 'Требуется срочная врачебная оценка',
} as const;

const MORPHOLOGY_FIELDS: readonly {
  readonly id: keyof EcgMorphologyObservations;
  readonly label: string;
}[] = [
  {
    id: 'rightPrecordialTerminalRPrime',
    label: 'V1–V2: rsr′, rsR′ или rSR′',
  },
  {
    id: 'lateralWideTerminalS',
    label: 'I и V6: широкая терминальная S',
  },
  {
    id: 'lateralBroadNotchedR',
    label: 'I, aVL, V5–V6: широкий зазубренный или сглаженный R',
  },
  {
    id: 'lateralQWaveAbsent',
    label: 'I, V5–V6: q отсутствует',
  },
  {
    id: 'lateralRPeakTimeOver60Ms',
    label: 'V5–V6: время до пика R больше 60 мс',
  },
];

const DEFAULT_PHOTO_CORNERS: EcgPhotoCorners = {
  bottomLeft: { x: 0.02, y: 0.98 },
  bottomRight: { x: 0.98, y: 0.98 },
  topLeft: { x: 0.02, y: 0.02 },
  topRight: { x: 0.98, y: 0.02 },
};

export function EcgPhotoCaliper(): JSX.Element {
  const zoom = usePinchZoom({ expandScrollPort: true });
  const [photoUrl, setPhotoUrl] = createSignal<string>();
  const [photoFile, setPhotoFile] = createSignal<File>();
  const [photoName, setPhotoName] = createSignal('');
  const [photoRevision, setPhotoRevision] = createSignal(0);
  const [imageWidth, setImageWidth] = createSignal(0);
  const [imageHeight, setImageHeight] = createSignal(0);
  const [patientRoute, setPatientRoute] = createSignal<EcgPatientRoute>('unknown');
  const [recordingProfileConfirmed, setRecordingProfileConfirmed] = createSignal(false);
  const [mode, setMode] = createSignal<CaliperMode>('calibration');
  const [calibration, setCalibration] = createSignal<EcgPointPair>();
  const [pairs, setPairs] = createSignal<Partial<Record<EcgIntervalId, EcgPointPair>>>({});
  const [dragKind, setDragKind] = createSignal<CaliperDragKind>();
  const [model, setModel] = createSignal<EcgModelDescriptor | null>(null);
  const [diagnosticModel, setDiagnosticModel] = createSignal<EcgDiagnosticModelDescriptor | null>(
    null,
  );
  const [installingModules, setInstallingModules] = createSignal(false);
  const [installationProgress, setInstallationProgress] = createSignal(0);
  const [installationError, setInstallationError] = createSignal('');
  const [digitizing, setDigitizing] = createSignal(false);
  const [digitization, setDigitization] = createSignal<EcgDigitizationResult>();
  const [digitizationError, setDigitizationError] = createSignal('');
  const [digitizationDialogOpen, setDigitizationDialogOpen] = createSignal(false);
  const [sourcePhotoDialogOpen, setSourcePhotoDialogOpen] = createSignal(false);
  const [manualWorkflowOpen, setManualWorkflowOpen] = createSignal(false);
  const [rectifying, setRectifying] = createSignal(false);
  const [photoCorners, setPhotoCorners] = createSignal<EcgPhotoCorners>(DEFAULT_PHOTO_CORNERS);
  const [rectifiedPhotoUrl, setRectifiedPhotoUrl] = createSignal<string>();
  const [imageView, setImageView] = createSignal<'original' | 'rectified'>('original');
  const [automaticMeasurements, setAutomaticMeasurements] = createSignal<EcgMeasurements>({});
  const [automaticMeasurementsAccepted, setAutomaticMeasurementsAccepted] = createSignal(false);
  const [morphology, setMorphology] = createSignal<EcgMorphologyObservations>({});
  let zoomContent: HTMLDivElement | undefined;
  let drag: CaliperDrag | undefined;
  let activeInstallation: AbortController | undefined;
  let pendingImageWidth: number | undefined;
  const activePointers = new Set<number>();

  const displayedPhotoUrl = createMemo(() =>
    imageView() === 'rectified' ? (rectifiedPhotoUrl() ?? photoUrl()) : photoUrl(),
  );
  const primaryPhotoUrl = createMemo(() => rectifiedPhotoUrl() ?? photoUrl());

  const pixelsPerMillimeter = createMemo(() => {
    const pair = calibration();
    return pair ? Math.abs(pair.end - pair.start) / 25 : 0;
  });
  const manualMeasurements = createMemo(() =>
    calculateEcgMeasurements(pairs(), pixelsPerMillimeter()),
  );
  const measurements = createMemo(() => ({
    ...(automaticMeasurementsAccepted() ? automaticMeasurements() : {}),
    ...manualMeasurements(),
  }));
  const automaticAmplitudeValues = createMemo(() => {
    const result = digitization();
    return automaticMeasurementsAccepted() &&
      result &&
      canAcceptEcgAutomaticDraft(result, recordingProfileConfirmed())
      ? ecgAmplitudeSuggestions(result)
      : {};
  });
  const automaticDraftAccepted = createMemo(() => {
    const result = digitization();
    return Boolean(
      automaticMeasurementsAccepted() &&
        result &&
        canAcceptEcgAutomaticDraft(result, recordingProfileConfirmed()),
    );
  });
  const interpretationScale = createMemo(() => {
    const manual = pixelsPerMillimeter();
    if (manual > 0) return manual;
    const automatic = digitization();
    return automaticMeasurementsAccepted() && automatic?.quality === 'usable'
      ? automatic.gridPixelsPerMillimeter
      : 0;
  });
  const interpretation = createMemo(() =>
    interpretEcgPhoto({
      adultConfirmed: patientRoute() === 'adult',
      recordingProfileConfirmed: recordingProfileConfirmed(),
      imageWidth: imageWidth(),
      imageHeight: imageHeight(),
      pixelsPerMillimeter: interpretationScale(),
      measurements: measurements(),
      morphology: morphology(),
    }),
  );
  const photoQuality = createMemo(() => {
    if (!imageWidth() || !imageHeight()) return undefined;
    return (
      imageWidth() >= ECG_MIN_IMAGE_WIDTH_PX &&
      imageHeight() >= ECG_MIN_IMAGE_HEIGHT_PX &&
      imageWidth() > imageHeight()
    );
  });
  const currentPair = createMemo(() => {
    const currentMode = mode();
    return currentMode === 'calibration' ? calibration() : pairs()[currentMode];
  });
  const pairPosition = createMemo(() => {
    const pair = currentPair();
    const width = imageWidth();
    if (!pair || !width) return undefined;
    const start = Math.max(0, Math.min(100, (pair.start / width) * 100));
    const end = Math.max(0, Math.min(100, (pair.end / width) * 100));
    return {
      start: `${start}%`,
      end: `${end}%`,
      left: `${Math.min(start, end)}%`,
      width: `${Math.abs(end - start)}%`,
    };
  });

  const setCurrentPair = (pair: EcgPointPair | undefined): void => {
    const currentMode = mode();
    if (currentMode === 'calibration') setCalibration(pair);
    else
      setPairs((current) => {
        const next = { ...current };
        if (pair) next[currentMode] = pair;
        else delete next[currentMode];
        return next;
      });
  };

  const imageX = (event: PointerEvent): number => {
    const bounds = zoomContent?.getBoundingClientRect();
    if (!bounds || !imageWidth()) return 0;
    return Math.max(
      0,
      Math.min(
        imageWidth(),
        ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * imageWidth(),
      ),
    );
  };

  const restoreDrag = (): void => {
    if (drag) setCurrentPair(drag.initialPair);
    drag = undefined;
    setDragKind(undefined);
  };

  const beginDrag = (kind: CaliperDragKind, event: PointerEvent): void => {
    if (rectifying() || !imageWidth() || event.button !== 0) return;
    const initialPair = currentPair();
    if (kind !== 'new' && !initialPair) return;
    event.preventDefault();
    activePointers.add(event.pointerId);
    if (activePointers.size > 1) {
      restoreDrag();
      return;
    }
    const x = imageX(event);
    drag = { kind, pointerId: event.pointerId, originX: x, initialPair };
    setDragKind(kind);
    if (kind === 'new') setCurrentPair({ start: x, end: x });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const updateDrag = (event: PointerEvent): void => {
    if (!drag || drag.pointerId !== event.pointerId || activePointers.size > 1) return;
    const x = imageX(event);
    const pair = drag.initialPair;
    event.preventDefault();
    if (drag.kind === 'new') setCurrentPair({ start: drag.originX, end: x });
    else if (drag.kind === 'start' && pair) setCurrentPair({ ...pair, start: x });
    else if (drag.kind === 'end' && pair) setCurrentPair({ ...pair, end: x });
    else if (drag.kind === 'range' && pair)
      setCurrentPair(shiftEcgPointPair(pair, x - drag.originX, imageWidth()));
  };

  const finishDrag = (event: PointerEvent, cancelled = false): void => {
    activePointers.delete(event.pointerId);
    if (!drag || drag.pointerId !== event.pointerId) return;
    const pair = currentPair();
    if (cancelled || (drag.kind === 'new' && pair && Math.abs(pair.end - pair.start) < 2)) {
      setCurrentPair(drag.initialPair);
    }
    drag = undefined;
    setDragKind(undefined);
  };

  const adjustWithKeyboard = (
    kind: Exclude<CaliperDragKind, 'new'>,
    event: KeyboardEvent,
  ): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const pair = currentPair();
    if (!pair) return;
    event.preventDefault();
    const delta = (event.key === 'ArrowLeft' ? -1 : 1) * Math.max(1, imageWidth() / 200);
    if (kind === 'range') setCurrentPair(shiftEcgPointPair(pair, delta, imageWidth()));
    else
      setCurrentPair({
        ...pair,
        [kind]: Math.max(0, Math.min(imageWidth(), pair[kind] + delta)),
      });
  };

  const resetMeasurements = (): void => {
    setMode('calibration');
    setCalibration(undefined);
    setPairs({});
  };

  const rescaleMeasurements = (previousWidth: number, nextWidth: number): void => {
    setCalibration((current) =>
      current ? rescaleEcgPointPair(current, previousWidth, nextWidth) : undefined,
    );
    setPairs((current) => {
      const next: Partial<Record<EcgIntervalId, EcgPointPair>> = {};
      for (const interval of INTERVALS) {
        const pair = current[interval.id];
        if (pair) next[interval.id] = rescaleEcgPointPair(pair, previousWidth, nextWidth);
      }
      return next;
    });
  };

  const selectImageView = (next: 'original' | 'rectified'): void => {
    if (next === imageView() || (next === 'rectified' && !rectifiedPhotoUrl())) return;
    pendingImageWidth = imageWidth() || undefined;
    setImageView(next);
    setImageWidth(0);
    setImageHeight(0);
    zoom.reset();
  };

  const loadPhoto = (file: File | undefined): void => {
    if (!file?.type.startsWith('image/')) return;
    const previousUrl = photoUrl();
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    const previousRectifiedUrl = rectifiedPhotoUrl();
    if (previousRectifiedUrl) URL.revokeObjectURL(previousRectifiedUrl);
    setPhotoUrl(URL.createObjectURL(file));
    setPhotoFile(file);
    setPhotoName(file.name);
    pendingImageWidth = undefined;
    setPhotoRevision((current) => current + 1);
    setImageWidth(0);
    setImageHeight(0);
    setPatientRoute('unknown');
    setRecordingProfileConfirmed(false);
    resetMeasurements();
    setDigitization(undefined);
    setDigitizationError('');
    setDigitizationDialogOpen(false);
    setSourcePhotoDialogOpen(false);
    setManualWorkflowOpen(false);
    setRectifying(false);
    setPhotoCorners(DEFAULT_PHOTO_CORNERS);
    setRectifiedPhotoUrl(undefined);
    setImageView('original');
    setAutomaticMeasurements({});
    setAutomaticMeasurementsAccepted(false);
    setMorphology({});
    zoom.reset();
    queueMicrotask(() => {
      if (model()) void digitize();
    });
  };

  const showRectifiedPreview = async (file: File, corners: EcgPhotoCorners): Promise<void> => {
    const preview = await createRectifiedEcgPhotoPreview(file, corners);
    if (photoFile() !== file) return;
    const previousUrl = rectifiedPhotoUrl();
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    const previousWidth = imageWidth();
    setRectifiedPhotoUrl(URL.createObjectURL(preview.blob));
    setImageView('rectified');
    pendingImageWidth = undefined;
    if (previousWidth) rescaleMeasurements(previousWidth, preview.width);
    setImageWidth(preview.width);
    setImageHeight(preview.height);
    zoom.reset();
  };

  const digitize = async (corners?: EcgPhotoCorners): Promise<void> => {
    const file = photoFile();
    if (!file || !model()) return;
    setDigitizationDialogOpen(true);
    setDigitizing(true);
    setDigitization(undefined);
    setDigitizationError('');
    setAutomaticMeasurements({});
    setAutomaticMeasurementsAccepted(false);
    try {
      if (corners) await showRectifiedPreview(file, corners);
      const result = await digitizeEcgPhoto(file, corners);
      if (photoFile() !== file) return;
      if (!corners && result.detectedGridCorners) {
        await showRectifiedPreview(file, result.detectedGridCorners);
      }
      setDigitization(result);
      if (result.quality !== 'usable' || !result.rrMs || !result.heartRate) {
        setManualWorkflowOpen(true);
      }
      if (result.quality === 'usable' && result.rrMs && result.heartRate) {
        setAutomaticMeasurements({
          rrMs: result.rrMs,
          heartRate: result.heartRate,
          ...ecgIntervalSuggestions(result),
        });
      }
    } catch (cause) {
      setManualWorkflowOpen(true);
      setDigitizationError(
        cause instanceof Error ? cause.message : 'Не удалось оцифровать кривые ЭКГ.',
      );
    } finally {
      setDigitizing(false);
    }
  };

  const continueWithManualReview = (): void => {
    setDigitizationDialogOpen(false);
    setManualWorkflowOpen(true);
  };

  const acceptAutomaticMeasurements = (): void => {
    const result = digitization();
    if (!result || !canAcceptEcgAutomaticDraft(result, recordingProfileConfirmed())) return;
    setAutomaticMeasurementsAccepted(true);
    continueWithManualReview();
  };

  const installAllModules = async (): Promise<void> => {
    if (installingModules()) {
      activeInstallation?.abort();
      return;
    }
    const digitizerCandidate = ECG_MODEL_CATALOG[0];
    const diagnosticCandidate = ECG_DIAGNOSTIC_MODEL_CATALOG[0];
    if (!digitizerCandidate || !diagnosticCandidate) return;
    const controller = new AbortController();
    activeInstallation = controller;
    setInstallingModules(true);
    setInstallationError('');
    setInstallationProgress(0);
    const digitizerBytes = model() ? 0 : digitizerCandidate.downloadBytes;
    const diagnosticBytes = diagnosticModel() ? 0 : diagnosticCandidate.downloadBytes;
    const totalBytes = Math.max(1, digitizerBytes + diagnosticBytes);
    let completedBytes = 0;
    try {
      if (!model()) {
        await installEcgModelFromCatalog(digitizerCandidate, {
          signal: controller.signal,
          onProgress: (downloadedBytes) =>
            setInstallationProgress((completedBytes + downloadedBytes) / totalBytes),
        });
        completedBytes += digitizerBytes;
      }
      if (!diagnosticModel()) {
        await installEcgDiagnosticModelFromCatalog(diagnosticCandidate, {
          signal: controller.signal,
          onProgress: (downloadedBytes) =>
            setInstallationProgress((completedBytes + downloadedBytes) / totalBytes),
        });
      }
      setInstallationProgress(1);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setInstallationError(
          cause instanceof Error ? cause.message : 'Не удалось установить модули ЭКГ.',
        );
      }
    } finally {
      if (activeInstallation === controller) activeInstallation = undefined;
      setInstallingModules(false);
    }
  };

  onMount(() => {
    const syncModel = (): void => {
      const installed = readEcgModelDescriptor();
      setModel(installed);
      if (installed && photoFile() && !digitization() && !digitizing()) {
        queueMicrotask(() => void digitize());
      }
    };
    syncModel();
    const unsubscribe = subscribeEcgModel(syncModel);
    const syncDiagnosticModel = (): void => {
      setDiagnosticModel(readEcgDiagnosticModelDescriptor());
    };
    syncDiagnosticModel();
    const unsubscribeDiagnosticModel = subscribeEcgDiagnosticModel(syncDiagnosticModel);
    const blockFileDrop = (event: DragEvent): void => {
      if (event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files')) {
        event.preventDefault();
      }
    };
    window.addEventListener('dragover', blockFileDrop);
    window.addEventListener('drop', blockFileDrop);
    onCleanup(() => {
      unsubscribe();
      unsubscribeDiagnosticModel();
      activeInstallation?.abort();
      window.removeEventListener('dragover', blockFileDrop);
      window.removeEventListener('drop', blockFileDrop);
    });
  });

  onCleanup(() => {
    const url = photoUrl();
    if (url) URL.revokeObjectURL(url);
    const rectifiedUrl = rectifiedPhotoUrl();
    if (rectifiedUrl) URL.revokeObjectURL(rectifiedUrl);
  });

  return (
    <section
      class="ecg-caliper"
      aria-label="Измерения по фото ЭКГ"
      onDragStart={(event) => event.preventDefault()}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
    >
      <section class="ecg-caliper__format" aria-labelledby="ecg-format-title">
        <AppGlyph name="info" class="ecg-caliper__format-icon" />
        <div class="ecg-caliper__format-copy">
          <strong id="ecg-format-title" class="ecg-caliper__format-title">
            Поддерживаемый формат ЭКГ
          </strong>
          <p class="ecg-caliper__format-text">
            Автоматическая обработка рассчитана на стандартную запись:
          </p>
          <ul class="ecg-caliper__format-list">
            <li class="ecg-caliper__format-item">12 отведений в 12 строк, около 5 секунд</li>
            <li class="ecg-caliper__format-item">скорость 50 мм/с</li>
            <li class="ecg-caliper__format-item">чувствительность 10 мм/мВ</li>
            <li class="ecg-caliper__format-item">
              взрослым доступны правила и числовая модель; детям — измерения и возрастные
              reference-flags
            </li>
          </ul>
        </div>
      </section>

      <div class="ecg-caliper__notice" role="note">
        <strong class="ecg-caliper__notice-title">Экспериментальный измеритель, не диагноз</strong>
        <span class="ecg-caliper__notice-text">
          Изображение обрабатывается только в браузере. Перспектива и изгиб бумаги искажают
          интервалы — при сомнении измерьте исходную плёнку вручную.
        </span>
      </div>

      <section class="ecg-example" aria-labelledby="ecg-example-title">
        <div class="ecg-example__header">
          <div class="ecg-example__heading-copy">
            <p class="ecg-example__kicker">1. Фото ЭКГ</p>
            <h3 id="ecg-example-title" class="ecg-example__title">
              {photoFile()
                ? rectifiedPhotoUrl()
                  ? 'Проверьте выправленный лист'
                  : 'Снимок загружен — ожидаем выправления'
                : 'Снимите весь лист ровно и без бликов'}
            </h3>
          </div>
          <span class="ecg-example__badge">
            {rectifiedPhotoUrl()
              ? 'Выправленный лист'
              : photoFile()
                ? 'Исходный снимок'
                : 'Пример хорошего кадра'}
          </span>
        </div>
        <Show
          when={photoFile()}
          fallback={
            <label class="ecg-example__upload">
              <img
                class="ecg-example__photo"
                src={ecgPhotoExample}
                alt="Пример: в кадре целиком виден горизонтальный лист двенадцатиканальной ЭКГ"
                draggable={false}
              />
              <span class="ecg-example__upload-action">
                <AppGlyph name="image" class="ecg-example__upload-icon" />
                Выбрать фото ЭКГ
              </span>
              <input
                class="ecg-example__file-input"
                type="file"
                accept="image/*"
                onChange={(event) => loadPhoto(event.currentTarget.files?.[0])}
              />
            </label>
          }
        >
          <figure class="ecg-example__workspace">
            <div class="ecg-example__image-frame">
              <div class="ecg-example__image-stage">
                <img
                  class="ecg-example__photo ecg-example__photo--workspace"
                  src={primaryPhotoUrl()}
                  alt={
                    rectifiedPhotoUrl()
                      ? 'Выправленный лист ЭКГ после локальной обработки'
                      : 'Исходный снимок ЭКГ до выправления'
                  }
                  draggable={false}
                  onLoad={(event) => {
                    setImageWidth(event.currentTarget.naturalWidth);
                    setImageHeight(event.currentTarget.naturalHeight);
                  }}
                />
                <Show when={digitization()?.qualityIssues.length}>
                  <div class="ecg-example__quality-overlay" aria-hidden="true">
                    <For each={digitization()?.qualityIssues ?? []}>
                      {(issue) => (
                        <span
                          class={`ecg-example__quality-region ecg-example__quality-region--${issue.severity}`}
                          style={{
                            height: `${issue.region.height * 100}%`,
                            left: `${issue.region.x * 100}%`,
                            top: `${issue.region.y * 100}%`,
                            width: `${issue.region.width * 100}%`,
                          }}
                        />
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
            <Show when={digitization()?.qualityIssues.length}>
              <ul class="ecg-example__quality-issues" aria-label="Проблемы качества снимка">
                <For each={digitization()?.qualityIssues ?? []}>
                  {(issue) => (
                    <li
                      class={`ecg-example__quality-issue ecg-example__quality-issue--${issue.severity}`}
                    >
                      <strong class="ecg-example__quality-issue-title">{issue.title}</strong>
                      <span class="ecg-example__quality-issue-detail">{issue.detail}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <figcaption class="ecg-example__workspace-actions">
              <button
                class="ecg-example__workspace-action"
                type="button"
                onClick={() => setSourcePhotoDialogOpen(true)}
              >
                <AppGlyph name="image" class="ecg-example__workspace-action-icon" />
                Исходник
              </button>
              <button
                class="ecg-example__workspace-action"
                type="button"
                disabled={!digitizing() && !digitization() && !digitizationError()}
                onClick={() => setDigitizationDialogOpen(true)}
              >
                <Show when={digitizing()}>
                  <span class="ecg-caliper__spinner" aria-hidden="true" />
                </Show>
                <AppGlyph name="graph" class="ecg-example__workspace-action-icon" />
                Кривые
              </button>
              <label class="ecg-example__workspace-action ecg-example__workspace-action--primary">
                <AppGlyph name="refresh" class="ecg-example__workspace-action-icon" />
                Заменить
                <input
                  class="ecg-example__file-input"
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    loadPhoto(event.currentTarget.files?.[0]);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
            </figcaption>
          </figure>
        </Show>
        <p class="ecg-example__note">
          {photoFile()
            ? rectifiedPhotoUrl()
              ? 'Это изображение используется для оцифровки и ручной разметки. Исходное фото остаётся доступно отдельно.'
              : 'Пока показан исходный снимок. После коррекции перспективы выправленный лист автоматически станет основным.'
            : 'Держите телефон параллельно листу: должны быть видны все края, сетка, калибровочные импульсы и подписи отведений. Пример показывает кадрирование, но напечатан на 25 мм/с; MiniMed принимает только 50 мм/с и 10 мм/мВ.'}
        </p>
      </section>

      <div class="ecg-caliper__model-status">
        <strong class="ecg-caliper__model-title">
          {model() ? 'Оцифровка готова' : 'Оцифровка не установлена'}
        </strong>
        <span class="ecg-caliper__model-text">
          {model()
            ? 'После загрузки снимка MiniMed автоматически проверит изображение, извлечёт кривые и заполнит числовой черновик.'
            : 'Одна установка добавит локальную оцифровку и числовую оценку. После загрузки всё работает на устройстве.'}
        </span>
        <Show when={!model() || !diagnosticModel()}>
          <button
            class="ecg-caliper__install"
            type="button"
            disabled={installingModules()}
            onClick={() => void installAllModules()}
          >
            <Show when={installingModules()}>
              <span class="ecg-caliper__spinner" aria-hidden="true" />
            </Show>
            {installingModules()
              ? `Установка ${Math.round(installationProgress() * 100)}%`
              : 'Установить всё'}
          </button>
        </Show>
        <Show when={model() && photoFile()}>
          <button
            class="ecg-caliper__process"
            type="button"
            onClick={() => setDigitizationDialogOpen(true)}
          >
            <Show when={digitizing()}>
              <span class="ecg-caliper__spinner" aria-hidden="true" />
            </Show>
            {digitizing()
              ? 'Оцифровка выполняется'
              : digitizationError()
                ? 'Не удалось — открыть подсказку'
                : digitization()
                  ? 'Посмотреть результат оцифровки'
                  : 'Оцифровка начнётся автоматически'}
          </button>
        </Show>
        <details class="ecg-caliper__module-details">
          <summary class="ecg-caliper__module-summary">Что будет установлено</summary>
          <ul class="ecg-caliper__module-list">
            <li class="ecg-caliper__module-item">Оцифровка фото · 19,1 МБ</li>
            <li class="ecg-caliper__module-item">Числовая оценка · 0,26 МБ</li>
          </ul>
          <button
            class="ecg-caliper__model-link"
            type="button"
            onClick={() => {
              rememberReturnTo();
              window.location.hash = '#/settings';
            }}
          >
            Состав, лицензии и удаление
          </button>
        </details>
        <Show when={installationError()}>
          <span class="ecg-caliper__digitization-error" role="alert">
            {installationError()}
          </span>
        </Show>
      </div>

      <Show when={photoUrl()}>
        {(url) => (
          <details
            class="ecg-caliper__manual-workflow"
            open={manualWorkflowOpen()}
            onToggle={(event) => setManualWorkflowOpen(event.currentTarget.open)}
          >
            <summary class="ecg-caliper__manual-summary">
              2. Проверить снимок и разметить вручную
            </summary>
            <div class="ecg-caliper__manual-body">
              <Show
                when={
                  digitizationError() ||
                  digitization()?.quality === 'review' ||
                  digitization()?.quality === 'failed'
                }
              >
                <div class="ecg-caliper__manual-fallback" role="note">
                  <strong class="ecg-caliper__manual-fallback-title">
                    {digitization()?.quality === 'review'
                      ? 'Автоматическую разметку нужно проверить'
                      : 'Автоматическая оцифровка не прошла проверку'}
                  </strong>
                  <span class="ecg-caliper__manual-fallback-text">
                    Сначала подтвердите параметры записи, затем отметьте 25 мм сетки и интервалы по
                    очереди. Красные границы можно перетаскивать; каждое числовое поле ниже имеет
                    пример по кнопке «?».
                  </span>
                </div>
              </Show>
              <Show when={digitization()?.quality === 'usable'}>
                <div class="ecg-caliper__manual-auto" role="note">
                  <strong class="ecg-caliper__manual-auto-title">
                    Автоматическая разметка готова — проверьте интервалы
                  </strong>
                  <span class="ecg-caliper__manual-auto-text">
                    RR, ЧСС и амплитуды перенесены в числовой черновик. Последовательно отметьте
                    сетку, P, PR, QRS и QT; затем проверьте все значения на шаге 3.
                  </span>
                  <button
                    class="ecg-caliper__manual-auto-review"
                    type="button"
                    onClick={() => setDigitizationDialogOpen(true)}
                  >
                    Посмотреть извлечённые кривые
                  </button>
                </div>
              </Show>
              <div class="ecg-caliper__profile" role="note">
                <strong class="ecg-caliper__profile-title">Профиль записи</strong>
                <span class="ecg-caliper__profile-text">
                  {ECG_PAPER_SPEED_MM_PER_SECOND} мм/с · {ECG_SENSITIVITY_MM_PER_MILLIVOLT} мм/мВ ·
                  1 мм = {ECG_MILLISECONDS_PER_MILLIMETER} мс · {ECG_SENSITIVITY_MM_PER_MILLIVOLT}{' '}
                  мм = 1 мВ · стандартная 12-отведённая ЭКГ
                </span>
                <label class="ecg-caliper__profile-confirmation">
                  <input
                    class="ecg-caliper__profile-confirmation-input"
                    type="checkbox"
                    checked={recordingProfileConfirmed()}
                    onChange={(event) => {
                      setRecordingProfileConfirmed(event.currentTarget.checked);
                      if (!event.currentTarget.checked) setAutomaticMeasurementsAccepted(false);
                    }}
                  />
                  <span class="ecg-caliper__profile-confirmation-label">
                    На записи указано 50 мм/с и 10 мм/мВ, все 12 отведений идут отдельными строками
                  </span>
                </label>
              </div>
              <p class="ecg-caliper__profile-text">
                Дата рождения и дата ЭКГ задаются на шаге 3. Взрослые правила запускаются только при
                рассчитанном возрасте 18 лет или старше.
              </p>
              <div class="ecg-caliper__toolbar">
                <Show when={rectifiedPhotoUrl()}>
                  <button
                    class={`ecg-caliper__view-toggle ${imageView() === 'rectified' ? 'ecg-caliper__view-toggle--active' : ''}`}
                    type="button"
                    aria-pressed={imageView() === 'rectified'}
                    aria-label={
                      imageView() === 'rectified'
                        ? 'Показать исходный снимок'
                        : 'Показать выправленный лист'
                    }
                    title={
                      imageView() === 'rectified'
                        ? 'Показать исходный снимок'
                        : 'Показать выправленный лист'
                    }
                    onClick={() =>
                      selectImageView(imageView() === 'rectified' ? 'original' : 'rectified')
                    }
                  >
                    <AppGlyph name="file-text" class="ecg-caliper__view-toggle-icon" />
                  </button>
                </Show>
                <div class="ecg-caliper__zoom-controls">
                  <button
                    class="ecg-caliper__zoom-button"
                    type="button"
                    aria-label="Уменьшить изображение"
                    disabled={zoom.scale() <= 1}
                    onClick={zoom.zoomOut}
                  >
                    −
                  </button>
                  <button
                    class="ecg-caliper__zoom-value"
                    type="button"
                    aria-label="Сбросить масштаб"
                    onClick={() => zoom.reset({ animated: true })}
                  >
                    {Math.round(zoom.scale() * 100)}%
                  </button>
                  <button
                    class="ecg-caliper__zoom-button"
                    type="button"
                    aria-label="Увеличить изображение"
                    disabled={zoom.scale() >= 3}
                    onClick={zoom.zoomIn}
                  >
                    +
                  </button>
                </div>
                <button class="ecg-caliper__reset" type="button" onClick={resetMeasurements}>
                  Сбросить точки
                </button>
                <Show when={model()}>
                  <div class="ecg-caliper__rectification-actions">
                    <button
                      class="ecg-caliper__rectify"
                      type="button"
                      disabled={digitizing()}
                      onClick={() => setRectifying((current) => !current)}
                    >
                      {rectifying() ? 'Отменить коррекцию' : 'Исправить перспективу'}
                    </button>
                    <Show when={rectifying()}>
                      <button
                        class="ecg-caliper__apply-rectification"
                        type="button"
                        disabled={digitizing()}
                        onClick={() => {
                          setRectifying(false);
                          void digitize(photoCorners());
                        }}
                      >
                        Выпрямить и оцифровать
                      </button>
                    </Show>
                  </div>
                </Show>
              </div>

              <p
                class={`ecg-caliper__quality ${photoQuality() ? 'ecg-caliper__quality--ok' : 'ecg-caliper__quality--warning'}`}
                role="status"
              >
                {photoName()} · {imageWidth()}×{imageHeight()} px ·{' '}
                {photoQuality()
                  ? 'размер и ориентация подходят для проверки'
                  : `размер или ориентация не подходят для проверки (нужно не меньше ${ECG_MIN_IMAGE_WIDTH_PX}×${ECG_MIN_IMAGE_HEIGHT_PX} px)`}
              </p>

              <div class="ecg-caliper__mode-list">
                <button
                  class={`ecg-caliper__mode ${mode() === 'calibration' ? 'ecg-caliper__mode--active' : ''}`}
                  type="button"
                  onClick={() => setMode('calibration')}
                >
                  1. Калибровка сетки 25 мм {calibration() ? '✓' : ''}
                </button>
                <For each={INTERVALS}>
                  {(interval, index) => (
                    <button
                      class={`ecg-caliper__mode ${mode() === interval.id ? 'ecg-caliper__mode--active' : ''}`}
                      type="button"
                      disabled={!calibration()}
                      onClick={() => setMode(interval.id)}
                    >
                      {index() + 2}. {interval.label} {pairs()[interval.id] ? '✓' : ''}
                    </button>
                  )}
                </For>
              </div>

              <p class="ecg-caliper__instruction">
                {rectifying()
                  ? 'Перетащите четыре маркера точно на углы листа, затем повторите оцифровку.'
                  : `${MANUAL_INSTRUCTIONS[mode()]} Границы и весь диапазон можно перетаскивать; масштаб — кнопками или двумя пальцами.`}
              </p>

              <div class="ecg-caliper__image-scroll">
                <div
                  ref={zoom.ref}
                  class="ecg-caliper__zoom-surface"
                  classList={{
                    'ecg-caliper__zoom-surface--dragging': Boolean(dragKind()),
                    'ecg-caliper__zoom-surface--rectifying': rectifying(),
                  }}
                  data-pinch-zoom-surface
                  onPointerDown={(event) => beginDrag('new', event)}
                  onPointerMove={updateDrag}
                  onPointerUp={finishDrag}
                  onPointerCancel={(event) => finishDrag(event, true)}
                >
                  <div
                    ref={(element) => {
                      zoomContent = element;
                      zoom.contentRef(element);
                    }}
                    class="ecg-caliper__zoom-content"
                  >
                    <img
                      class="ecg-caliper__image"
                      src={displayedPhotoUrl() ?? url()}
                      alt={
                        imageView() === 'rectified'
                          ? 'Выправленная ЭКГ для ручных измерений'
                          : 'Исходная ЭКГ для ручных измерений'
                      }
                      draggable={false}
                      onDragStart={(event) => event.preventDefault()}
                      onLoad={(event) => {
                        const nextWidth = event.currentTarget.naturalWidth;
                        const previousWidth = pendingImageWidth;
                        pendingImageWidth = undefined;
                        if (previousWidth) rescaleMeasurements(previousWidth, nextWidth);
                        setImageWidth(nextWidth);
                        setImageHeight(event.currentTarget.naturalHeight);
                      }}
                    />
                    <Show when={rectifying()}>
                      <EcgPerspectiveEditor corners={photoCorners()} onChange={setPhotoCorners} />
                    </Show>
                    <Show when={pairPosition()}>
                      {(position) => (
                        <>
                          <button
                            class="ecg-caliper__range"
                            type="button"
                            aria-label="Переместить выбранный диапазон"
                            style={{ left: position().left, width: position().width }}
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              beginDrag('range', event);
                            }}
                            onKeyDown={(event) => adjustWithKeyboard('range', event)}
                          />
                          <button
                            class="ecg-caliper__marker"
                            type="button"
                            aria-label="Переместить начало диапазона"
                            style={{ left: position().start }}
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              beginDrag('start', event);
                            }}
                            onKeyDown={(event) => adjustWithKeyboard('start', event)}
                          />
                          <button
                            class="ecg-caliper__marker"
                            type="button"
                            aria-label="Переместить конец диапазона"
                            style={{ left: position().end }}
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              beginDrag('end', event);
                            }}
                            onKeyDown={(event) => adjustWithKeyboard('end', event)}
                          />
                        </>
                      )}
                    </Show>
                  </div>
                </div>
              </div>

              <fieldset class="ecg-caliper__morphology">
                <legend class="ecg-caliper__morphology-title">Морфология QRS</legend>
                <p class="ecg-caliper__morphology-note">
                  Заполните только признаки, которые уверенно видны. «Не оценено» никогда не
                  считается отсутствием признака.
                </p>
                <div class="ecg-caliper__morphology-grid">
                  <For each={MORPHOLOGY_FIELDS}>
                    {(field) => (
                      <label class="ecg-caliper__morphology-field">
                        <span class="ecg-caliper__morphology-label">{field.label}</span>
                        <select
                          class="ecg-caliper__morphology-select"
                          value={morphology()[field.id] ?? 'unknown'}
                          onChange={(event) =>
                            setMorphology((current) => ({
                              ...current,
                              [field.id]: event.currentTarget.value as EcgObservationState,
                            }))
                          }
                        >
                          <option value="unknown">Не оценено</option>
                          <option value="present">Есть</option>
                          <option value="absent">Нет</option>
                        </select>
                      </label>
                    )}
                  </For>
                </div>
              </fieldset>

              <Show when={calibration() || automaticMeasurements().rrMs}>
                <div class="ecg-caliper__results" aria-live="polite">
                  <h4 class="ecg-caliper__results-title">Измерения</h4>
                  <dl class="ecg-caliper__result-list">
                    <Show when={measurements().rrMs}>
                      {(value) => (
                        <div class="ecg-caliper__result-row">
                          <dt class="ecg-caliper__result-name">RR</dt>
                          <dd class="ecg-caliper__result-value">{value()} мс</dd>
                        </div>
                      )}
                    </Show>
                    <Show when={measurements().heartRate}>
                      {(value) => (
                        <div class="ecg-caliper__result-row">
                          <dt class="ecg-caliper__result-name">ЧСС</dt>
                          <dd class="ecg-caliper__result-value">{value()} /мин</dd>
                        </div>
                      )}
                    </Show>
                    <For
                      each={
                        [
                          ['P', measurements().pDurationMs],
                          ['PR', measurements().prMs],
                          ['QRS', measurements().qrsMs],
                          ['QT', measurements().qtMs],
                          ['QTc Bazett', measurements().qtcBazettMs],
                          ['QTc Fridericia', measurements().qtcFridericiaMs],
                          ['QTc Framingham', measurements().qtcFraminghamMs],
                        ] as const
                      }
                    >
                      {([label, value]) => (
                        <Show when={value}>
                          {(shown) => (
                            <div class="ecg-caliper__result-row">
                              <dt class="ecg-caliper__result-name">{label}</dt>
                              <dd class="ecg-caliper__result-value">{shown()} мс</dd>
                            </div>
                          )}
                        </Show>
                      )}
                    </For>
                  </dl>
                </div>
              </Show>

              <div class="ecg-caliper__interpretation" aria-live="polite">
                <h4 class="ecg-caliper__interpretation-title">Проверка измерений</h4>
                <Show
                  when={patientRoute() !== 'pediatric'}
                  fallback={
                    <p class="ecg-caliper__eligibility-text">
                      Детский маршрут сохраняет оцифровку и измерения. Возрастные reference-flags
                      показаны на шаге 3; взрослые правила здесь не запускаются.
                    </p>
                  }
                >
                  <Show
                    when={interpretation().eligible}
                    fallback={
                      <div class="ecg-caliper__eligibility">
                        <p class="ecg-caliper__eligibility-text">
                          Правила доступны после ввода возраста, подтверждения профиля, подходящего
                          изображения и калибровки сетки.
                        </p>
                        <ul class="ecg-caliper__eligibility-list">
                          <For each={interpretation().eligibility.issues}>
                            {(issue) => <li class="ecg-caliper__eligibility-item">{issue.text}</li>}
                          </For>
                        </ul>
                      </div>
                    }
                  >
                    <p
                      class={`ecg-caliper__interpretation-status ecg-caliper__interpretation-status--${interpretation().status}`}
                    >
                      {INTERPRETATION_STATUS_LABELS[
                        interpretation().status as keyof typeof INTERPRETATION_STATUS_LABELS
                      ] ?? 'Измерения требуют оценки'}
                    </p>
                    <Show when={interpretation().findings.length > 0}>
                      <ul class="ecg-caliper__finding-list">
                        <For each={interpretation().findings}>
                          {(finding) => (
                            <li
                              class={`ecg-caliper__finding ecg-caliper__finding--${finding.severity}`}
                            >
                              <strong class="ecg-caliper__finding-text">{finding.text}</strong>
                              <span class="ecg-caliper__finding-evidence">
                                {finding.evidence.measurement} {finding.evidence.value}{' '}
                                {finding.evidence.unit ?? ''}; порог {finding.evidence.threshold}
                              </span>
                              <Show when={finding.criteria?.length}>
                                <ul class="ecg-caliper__finding-criteria">
                                  <For each={finding.criteria}>
                                    {(criterion) => (
                                      <li class="ecg-caliper__finding-criterion">{criterion}</li>
                                    )}
                                  </For>
                                </ul>
                              </Show>
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>
                    <Show when={interpretation().missingData.length > 0}>
                      <ul class="ecg-caliper__missing-list">
                        <For each={interpretation().missingData}>
                          {(item) => <li class="ecg-caliper__missing-item">{item.text}</li>}
                        </For>
                      </ul>
                    </Show>
                  </Show>
                </Show>
              </div>
              <button
                class="ecg-caliper__continue"
                type="button"
                onClick={() => setManualWorkflowOpen(false)}
              >
                Завершить разметку и перейти к расчёту
              </button>
            </div>
          </details>
        )}
      </Show>

      <OverlayDialog
        open={sourcePhotoDialogOpen()}
        title="Исходный снимок"
        subtitle={photoName() || 'До коррекции перспективы'}
        class="ecg-source-photo-dialog"
        bodyClass="ecg-source-photo-dialog__body"
        onClose={() => setSourcePhotoDialogOpen(false)}
      >
        <div class="ecg-source-photo-dialog__viewport">
          <img
            class="ecg-source-photo-dialog__image"
            src={photoUrl()}
            alt="Исходный снимок ЭКГ до выправления"
            draggable={false}
          />
        </div>
      </OverlayDialog>

      <OverlayDialog
        open={digitizationDialogOpen()}
        title="Оцифровка ЭКГ"
        subtitle="Локальная обработка снимка"
        class="ecg-digitization-dialog"
        bodyClass="ecg-digitization-dialog__body"
        onClose={() => setDigitizationDialogOpen(false)}
      >
        <Show when={digitizing()}>
          <div class="ecg-digitization-dialog__progress" role="status" aria-live="polite">
            <span class="ecg-caliper__spinner ecg-caliper__spinner--large" aria-hidden="true" />
            <strong class="ecg-digitization-dialog__progress-title">
              Выправляем лист и извлекаем 12 кривых
            </strong>
            <span class="ecg-digitization-dialog__progress-text">
              Окно можно закрыть — обработка продолжится на устройстве.
            </span>
          </div>
        </Show>
        <Show when={!digitizing() && digitizationError()}>
          <div class="ecg-digitization-dialog__failure" role="alert">
            <strong class="ecg-digitization-dialog__failure-title">
              Перейдите к ручной разметке
            </strong>
            <span class="ecg-digitization-dialog__failure-text">{digitizationError()}</span>
            <span class="ecg-digitization-dialog__failure-text">
              Закройте окно и раскройте шаг 2. Сначала отметьте 25 мм сетки, затем RR, P, PR, QRS и
              QT. У каждого числового поля есть справка с примером.
            </span>
            <div class="ecg-digitization-dialog__actions">
              <button
                class="ecg-digitization-dialog__manual"
                type="button"
                onClick={continueWithManualReview}
              >
                Перейти к ручной разметке
              </button>
              <button
                class="ecg-digitization-dialog__retry"
                type="button"
                onClick={() => void digitize()}
              >
                Повторить оцифровку
              </button>
            </div>
          </div>
        </Show>
        <Show when={!digitizing() && digitization()}>
          {(result) => (
            <div
              class={`ecg-caliper__digitization ecg-caliper__digitization--${result().quality}`}
              data-layout={result().layout}
              data-lead-count={result().leads.filter((lead) => lead.coverage >= 0.7).length}
              data-rhythm-coverage={result().rhythmCoverage}
              data-duration-seconds={result().durationSeconds}
              data-rr-ms={result().rrMs}
              data-heart-rate-bpm={result().heartRate}
            >
              <strong class="ecg-caliper__digitization-title" role="status">
                {result().quality === 'usable'
                  ? 'Оцифровка прошла проверку'
                  : result().quality === 'review'
                    ? 'Оцифровку нужно проверить вручную'
                    : 'Оцифровка отклонена'}
              </strong>
              <span class="ecg-caliper__digitization-meta">
                {result().layout === '12x1' ? '12×1' : '3×4 + II'} ·{' '}
                {result().leads.filter((lead) => lead.coverage >= 0.7).length}/12 отведений ·{' '}
                {result().durationSeconds.toFixed(1)} с · ритм II{' '}
                {Math.round(result().rhythmCoverage * 100)}%
              </span>
              <Show when={result().rrMs && result().heartRate}>
                <span class="ecg-caliper__digitization-meta">
                  RR {result().rrMs} мс · ЧСС {result().heartRate} /мин · автоматический черновик
                </span>
              </Show>
              <Show when={result().qualityReasons.length > 0}>
                <ul class="ecg-caliper__digitization-reasons">
                  <For each={result().qualityReasons}>
                    {(reason) => <li class="ecg-caliper__digitization-reason">{reason}</li>}
                  </For>
                </ul>
              </Show>
              <Show when={result().qualityIssues.length > 0}>
                <ul class="ecg-caliper__quality-issues" aria-label="Проблемы качества фотографии">
                  <For each={result().qualityIssues}>
                    {(issue) => (
                      <li
                        class={`ecg-caliper__quality-issue ecg-caliper__quality-issue--${issue.severity}`}
                        data-code={issue.code}
                      >
                        <strong class="ecg-caliper__quality-issue-title">{issue.title}</strong>
                        <span class="ecg-caliper__quality-issue-detail">{issue.detail}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={result().quality === 'usable' && result().rrMs && result().heartRate}>
                <label class="ecg-caliper__profile-confirmation">
                  <input
                    class="ecg-caliper__profile-confirmation-input"
                    type="checkbox"
                    checked={recordingProfileConfirmed()}
                    onChange={(event) => {
                      setRecordingProfileConfirmed(event.currentTarget.checked);
                      if (!event.currentTarget.checked) setAutomaticMeasurementsAccepted(false);
                    }}
                  />
                  <span class="ecg-caliper__profile-confirmation-label">
                    На записи указано 50 мм/с и 10 мм/мВ, раскладка 12×1
                  </span>
                </label>
                <button
                  class="ecg-caliper__accept-digitization"
                  type="button"
                  disabled={
                    automaticMeasurementsAccepted() ||
                    !canAcceptEcgAutomaticDraft(result(), recordingProfileConfirmed())
                  }
                  onClick={acceptAutomaticMeasurements}
                >
                  {automaticMeasurementsAccepted()
                    ? 'Автоизмерения приняты'
                    : result().layout !== '12x1'
                      ? 'Нужна раскладка 12×1'
                      : recordingProfileConfirmed()
                        ? 'Принять черновик и проверить интервалы'
                        : 'Сначала подтвердите профиль записи'}
                </button>
              </Show>
              <Show when={result().quality !== 'usable' || !result().rrMs || !result().heartRate}>
                <button
                  class="ecg-caliper__accept-digitization"
                  type="button"
                  onClick={continueWithManualReview}
                >
                  Перейти к ручной разметке
                </button>
              </Show>
              <Show when={result().leads.length > 0}>
                <EcgDigitizedWaveformReview result={result()} />
              </Show>
            </div>
          )}
        </Show>
      </OverlayDialog>

      <Show keyed when={photoFile() ?? 'example'}>
        {(study) => (
          <EcgNumericDiagnosticPanel
            automaticAmplitudeValues={automaticAmplitudeValues()}
            automaticMeasurementsDraft={automaticDraftAccepted() ? automaticMeasurements() : {}}
            exampleMode={study === 'example'}
            measurements={measurements()}
            morphology={morphology()}
            onPatientRouteChange={setPatientRoute}
            onMorphologyChange={(id, value) =>
              setMorphology((current) => ({ ...current, [id]: value }))
            }
            studyRevision={photoRevision()}
          />
        )}
      </Show>
    </section>
  );
}
