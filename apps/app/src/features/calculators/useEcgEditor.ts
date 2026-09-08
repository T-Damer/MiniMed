import { createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import {
  digitizeEcgPhoto,
  ECG_MODEL_CATALOG,
  installEcgModelFromCatalog,
  readEcgModelDescriptor,
  subscribeEcgModel,
} from './ecg-model';
import type { EcgModelDescriptor, EcgReviewMaps } from './ecg-model-contract';
import type { EcgPatientRoute } from './ecg-patient-age';
import type { EcgPatientSex } from './ecg-photo-interpreter';
import {
  type EcgEditorDraft,
  type EcgEditorStep,
  EMPTY_ECG_DRAFT,
  ecgCalibrationScale,
  ecgRegionTemplate,
  measureEcgEditor,
  validEcgRegions,
} from './ecgEditor';
import { extractEcgEditorRegion, prepareEcgEditorReview } from './ecgReviewExtraction';

export interface EcgEditorPhoto {
  readonly file: File;
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

async function readPhoto(file: File): Promise<EcgEditorPhoto> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Выберите фотографию JPEG, PNG или WebP.');
  if (file.size > 30 * 1024 * 1024 || file.size === 0)
    throw new Error('Размер фотографии должен быть от 1 байта до 30 МБ.');
  const bitmap = await createImageBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;
  bitmap.close();
  if (width < 128 || height < 128 || width * height > 40_000_000)
    throw new Error('Нужен снимок от 128 × 128 пикселей и не более 40 мегапикселей.');
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Не удалось прочитать фотографию.'));
    reader.onerror = () => reject(new Error('Не удалось прочитать фотографию.'));
    reader.readAsDataURL(file);
  });
  return { file, url, width, height };
}

export function useEcgEditor() {
  const [step, setStep] = createSignal<EcgEditorStep>(1);
  const [photo, setPhoto] = createSignal<EcgEditorPhoto>();
  const [draft, setDraft] = createSignal<EcgEditorDraft>(EMPTY_ECG_DRAFT);
  const [past, setPast] = createSignal<readonly EcgEditorDraft[]>([]);
  const [future, setFuture] = createSignal<readonly EcgEditorDraft[]>([]);
  const [calibrationConfirmed, setCalibrationConfirmed] = createSignal(false);
  const [regionsConfirmed, setRegionsConfirmed] = createSignal(false);
  const [pointsConfirmed, setPointsConfirmed] = createSignal(false);
  const [activeRegion, setActiveRegion] = createSignal('rhythm-II');
  const [measurementRegion, setMeasurementRegion] = createSignal('rhythm-II');
  const [patientRoute, setPatientRoute] = createSignal<EcgPatientRoute>('unknown');
  const [sex, setSex] = createSignal<EcgPatientSex | undefined>();
  const [maps, setMaps] = createSignal<EcgReviewMaps>();
  const [model, setModel] = createSignal<EcgModelDescriptor | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [digitizing, setDigitizing] = createSignal(false);
  const [installing, setInstalling] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [error, setError] = createSignal('');
  const [notice, setNotice] = createSignal('');
  let generation = 0;
  let installation: AbortController | undefined;

  const invalidate = (before: EcgEditorDraft, after: EcgEditorDraft): void => {
    if (before.calibration !== after.calibration) setCalibrationConfirmed(false);
    if (before.regions !== after.regions) setRegionsConfirmed(false);
    setPointsConfirmed(false);
  };
  const commit = (next: EcgEditorDraft): void => {
    const before = draft();
    if (before === next) return;
    setPast((values) => [...values.slice(-49), before]);
    setFuture([]);
    invalidate(before, next);
    setDraft(next);
  };
  const undo = (): void => {
    const previous = past().at(-1);
    if (!previous) return;
    setPast((values) => values.slice(0, -1));
    setFuture((values) => [...values, draft()]);
    invalidate(draft(), previous);
    setDraft(previous);
  };
  const redo = (): void => {
    const next = future().at(-1);
    if (!next) return;
    setFuture((values) => values.slice(0, -1));
    setPast((values) => [...values, draft()]);
    invalidate(draft(), next);
    setDraft(next);
  };
  const measurement = createMemo(() => measureEcgEditor(draft(), measurementRegion()));
  const canReviewPoints = createMemo(() =>
    Boolean(
      measurement().measurements.rrMs &&
        measurement().measurements.qrsMs &&
        !measurement().errors.length,
    ),
  );
  const completed = createMemo(() => [
    Boolean(photo()) && !loading(),
    Boolean(ecgCalibrationScale(draft().calibration)) && calibrationConfirmed(),
    validEcgRegions(draft().regions) && regionsConfirmed(),
    canReviewPoints() && pointsConfirmed(),
  ]);
  const generatePoints = (): void => {
    const currentMaps = maps();
    if (!currentMaps) return;
    const points = draft().regions.flatMap(
      (region) => extractEcgEditorRegion(currentMaps, region, draft().calibration).points,
    );
    commit({ ...draft(), points });
    setNotice(
      points.length
        ? 'Предложены точки. Проверьте границы каждого измеряемого комплекса по фотографии.'
        : 'Надёжные точки не найдены. Добавьте их вручную кнопками P, Q, R, S, T.',
    );
  };
  const go = (next: EcgEditorStep): void => {
    if (
      next > step() &&
      !completed()
        .slice(0, next - 1)
        .every(Boolean)
    )
      return;
    if (next === 4 && draft().points.length === 0) generatePoints();
    setStep(next);
  };
  const digitize = async (): Promise<void> => {
    const currentPhoto = photo();
    if (!currentPhoto || !model() || digitizing()) return;
    const version = generation;
    const before = draft();
    setDigitizing(true);
    setError('');
    setNotice('Ищем сетку и линии на устройстве…');
    try {
      const result = await digitizeEcgPhoto(currentPhoto.file, undefined, true);
      if (version !== generation) return;
      const review = prepareEcgEditorReview(result);
      if (!review) throw new Error('Оцифровщик не вернул разметку. Можно продолжить вручную.');
      setMaps(review.maps);
      const current = draft();
      // Late model results cannot replace edits or confirmations made while it was running.
      const applyCalibration =
        current.calibration === before.calibration && !calibrationConfirmed();
      const applyRegions = current.regions === before.regions && !regionsConfirmed();
      if (applyCalibration || applyRegions)
        commit({
          ...current,
          calibration: applyCalibration
            ? { ...current.calibration, ...review.calibration }
            : current.calibration,
          regions: applyRegions ? review.regions : current.regions,
        });
      if (applyRegions) {
        const id = review.regions.some((r) => r.id === 'rhythm-II') ? 'rhythm-II' : 'II';
        setActiveRegion(id);
        setMeasurementRegion(id);
      }
      setNotice(
        result.quality === 'usable'
          ? 'Линии найдены. Калибровку и области нужно подтвердить.'
          : 'Автоматическое распознавание требует проверки. Исправьте сетку и области вручную.',
      );
    } catch (cause) {
      if (version === generation) {
        setError(cause instanceof Error ? cause.message : 'Не удалось распознать ЭКГ.');
        setNotice('Доступна ручная разметка.');
      }
    } finally {
      if (version === generation) setDigitizing(false);
    }
  };
  const load = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const version = ++generation;
    setLoading(true);
    setDigitizing(false);
    setError('');
    setStep(1);
    setPointsConfirmed(false);
    try {
      const next = await readPhoto(file);
      if (version !== generation) return;
      setPhoto(next);
      setDraft({ ...EMPTY_ECG_DRAFT, regions: ecgRegionTemplate('3x4+1R') });
      setPast([]);
      setFuture([]);
      setMaps(undefined);
      setCalibrationConfirmed(false);
      setRegionsConfirmed(false);
      setActiveRegion('rhythm-II');
      setMeasurementRegion('rhythm-II');
      setPatientRoute('unknown');
      setSex(undefined);
      setNotice(
        model()
          ? ''
          : 'Модель не установлена. Можно разметить снимок вручную или установить оцифровку.',
      );
      if (model()) void digitize();
    } catch (cause) {
      if (version === generation)
        setError(cause instanceof Error ? cause.message : 'Не удалось открыть фотографию.');
    } finally {
      if (version === generation) setLoading(false);
    }
  };
  const install = async (): Promise<void> => {
    if (installing()) {
      installation?.abort();
      return;
    }
    const candidate = ECG_MODEL_CATALOG[0];
    if (!candidate) return;
    const controller = new AbortController();
    installation = controller;
    setInstalling(true);
    setProgress(0);
    setError('');
    try {
      await installEcgModelFromCatalog(candidate, {
        signal: controller.signal,
        onProgress: (bytes) => setProgress(Math.min(1, bytes / candidate.downloadBytes)),
      });
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Не удалось установить оцифровку.');
    } finally {
      setInstalling(false);
    }
  };
  onMount(() => {
    const sync = (): void => {
      setModel(readEcgModelDescriptor());
      if (model() && photo() && !maps() && !digitizing()) void digitize();
    };
    sync();
    const unsubscribe = subscribeEcgModel(sync);
    onCleanup(unsubscribe);
  });
  onCleanup(() => {
    generation += 1;
    installation?.abort();
  });
  return {
    step,
    go,
    photo,
    load,
    draft,
    commit,
    undo,
    redo,
    canUndo: () => past().length > 0,
    canRedo: () => future().length > 0,
    calibrationConfirmed,
    confirmCalibration: (value: boolean) =>
      setCalibrationConfirmed(value && Boolean(ecgCalibrationScale(draft().calibration))),
    regionsConfirmed,
    confirmRegions: (value: boolean) =>
      setRegionsConfirmed(value && validEcgRegions(draft().regions)),
    pointsConfirmed,
    confirmPoints: (value: boolean) => setPointsConfirmed(value && canReviewPoints()),
    canReviewPoints,
    completed,
    activeRegion,
    setActiveRegion,
    measurementRegion,
    setMeasurementRegion: (id: string) => {
      setMeasurementRegion(id);
      setPointsConfirmed(false);
    },
    patientRoute,
    setPatientRoute: (value: EcgPatientRoute) => {
      setPatientRoute(value);
      setPointsConfirmed(false);
    },
    sex,
    setSex: (value: EcgPatientSex | undefined) => {
      setSex(value);
      setPointsConfirmed(false);
    },
    measurement,
    maps,
    model,
    loading,
    digitizing,
    digitize,
    generatePoints,
    install,
    installing,
    progress,
    error,
    notice,
  };
}

export type EcgEditor = ReturnType<typeof useEcgEditor>;
