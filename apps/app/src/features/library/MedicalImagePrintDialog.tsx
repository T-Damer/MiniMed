import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';
import { Portal } from 'solid-js/web';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { Switch } from '@/components/Switch';
import {
  buildMedicalImagePrintHtml,
  columnsForMedicalImagePrint,
  MEDICAL_IMAGE_PRINT_GRID_MAX_IMAGES_PER_PAGE,
  MEDICAL_IMAGE_PRINT_MAX_IMAGES_PER_PAGE,
  type MedicalImagePrintCaptureOptions,
  type MedicalImagePrintDirection,
  type MedicalImagePrintFrame,
  type MedicalImagePrintLayout,
  type MedicalImagePrintOptions,
  medicalImagePrintOverlay,
  medicalImagePrintSlices,
} from '@/features/library/medical-image-print';
import { PrintManager } from '@/features/printing/print-manager';
import '@/styles/medical-image-print.css';

interface MedicalImagePrintDialogProps {
  readonly open: boolean;
  readonly documentId: string;
  readonly title: string;
  readonly directions: readonly MedicalImagePrintDirection[];
  readonly initialDirectionId?: MedicalImagePrintDirection['id'];
  readonly capture: (
    options: MedicalImagePrintCaptureOptions,
  ) => Promise<readonly MedicalImagePrintFrame[]>;
  readonly onClose: () => void;
}

interface GalleryDragState {
  readonly pointerId: number;
  readonly targetSelected: boolean;
  readonly target: HTMLElement;
  readonly visited: Set<number>;
}

interface StoredPrintSettings {
  readonly directionId?: string;
  readonly fromSlice?: number;
  readonly toSlice?: number;
  readonly imagesPerPage?: number;
  readonly includeAnnotations?: boolean;
}

let nextPrintDialogId = 0;
const PRINT_SETTINGS_KEY_PREFIX = 'minimed.medical-image-print:';

function directionValue(
  directions: readonly MedicalImagePrintDirection[],
  id: MedicalImagePrintDirection['id'],
): MedicalImagePrintDirection {
  return (
    directions.find((direction) => direction.id === id) ??
    directions[0] ?? {
      id: 'series',
      label: 'Серия',
      icon: 'film-strip',
      count: 0,
      current: 1,
    }
  );
}

const FRAME_KEY_SEPARATOR = '\u0000';

function printSettingsKey(documentId: string): string {
  return `${PRINT_SETTINGS_KEY_PREFIX}${encodeURIComponent(documentId)}`;
}

function loadPrintSettings(documentId: string): StoredPrintSettings | undefined {
  try {
    const raw = window.localStorage.getItem(printSettingsKey(documentId));
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const record = parsed as {
      readonly directionId?: unknown;
      readonly fromSlice?: unknown;
      readonly toSlice?: unknown;
      readonly imagesPerPage?: unknown;
      readonly includeAnnotations?: unknown;
    };
    return {
      ...(typeof record.directionId === 'string' ? { directionId: record.directionId } : {}),
      ...(typeof record.fromSlice === 'number' ? { fromSlice: record.fromSlice } : {}),
      ...(typeof record.toSlice === 'number' ? { toSlice: record.toSlice } : {}),
      ...(typeof record.imagesPerPage === 'number' ? { imagesPerPage: record.imagesPerPage } : {}),
      ...(typeof record.includeAnnotations === 'boolean'
        ? { includeAnnotations: record.includeAnnotations }
        : {}),
    };
  } catch {
    return undefined;
  }
}

function savePrintSettings(documentId: string, settings: StoredPrintSettings): void {
  try {
    window.localStorage.setItem(printSettingsKey(documentId), JSON.stringify(settings));
  } catch {
    // Storage can be unavailable in private browsing; settings still work for this session.
  }
}

function boundedSlice(value: number | undefined, count: number, fallback: number): number {
  const limit = Math.max(1, Math.floor(count));
  const candidate = Number.isFinite(value) ? Math.round(value as number) : fallback;
  return Math.min(limit, Math.max(1, candidate));
}

function frameKey(frame: MedicalImagePrintFrame): string {
  return `${frame.directionLabel}${FRAME_KEY_SEPARATOR}${frame.sliceLabel}`;
}

export function MedicalImagePrintDialog(props: MedicalImagePrintDialogProps): JSX.Element {
  const dialogId = `medical-image-print-${++nextPrintDialogId}`;
  const firstDirection = props.directions[0]?.id ?? 'series';
  const [directionId, setDirectionId] = createSignal<MedicalImagePrintDirection['id']>(
    props.initialDirectionId ?? firstDirection,
  );
  const [fromSlice, setFromSlice] = createSignal(1);
  const [toSlice, setToSlice] = createSignal(1);
  const [fromSliceText, setFromSliceText] = createSignal('1');
  const [toSliceText, setToSliceText] = createSignal('1');
  const [imagesPerPage, setImagesPerPage] = createSignal<MedicalImagePrintLayout>(1);
  const [includeAnnotations, setIncludeAnnotations] = createSignal(true);
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const [galleryOpen, setGalleryOpen] = createSignal(false);
  const [capturedFrames, setCapturedFrames] = createSignal<readonly MedicalImagePrintFrame[]>([]);
  const [selectedFrameKeys, setSelectedFrameKeys] = createSignal<readonly string[]>([]);
  const [capturing, setCapturing] = createSignal(false);
  const [captureError, setCaptureError] = createSignal<string | null>(null);
  let captureGeneration = 0;
  let wasOpen = false;
  let settingsInitialized = false;
  let captureTimer: number | undefined;
  let captureAbortController: AbortController | undefined;
  let settingsSaveTimer: number | undefined;
  let previousDirectionId: MedicalImagePrintDirection['id'] | undefined;
  let galleryDrag: GalleryDragState | undefined;
  let suppressGalleryClick = false;

  const direction = createMemo(() => directionValue(props.directions, directionId()));
  const sliceMaximum = createMemo(() => Math.max(1, Math.floor(direction().count)));
  const imagesPerPageMaximum = createMemo(() =>
    direction().id === 'grid'
      ? MEDICAL_IMAGE_PRINT_GRID_MAX_IMAGES_PER_PAGE
      : MEDICAL_IMAGE_PRINT_MAX_IMAGES_PER_PAGE,
  );
  const selectedSlices = createMemo(() =>
    medicalImagePrintSlices(fromSlice(), toSlice(), 1, direction().count),
  );
  const selectedFrameKeySet = createMemo(() => new Set(selectedFrameKeys()));
  const frames = createMemo(() =>
    capturedFrames().filter((frame) => selectedFrameKeySet().has(frameKey(frame))),
  );
  const previewFrames = createMemo(() => frames().slice(0, imagesPerPage()));
  const previewFrame = createMemo(() => frames()[0]);
  const previewColumns = createMemo(() => columnsForMedicalImagePrint(imagesPerPage()));
  const fieldId = (name: string): string => `${dialogId}-${name}`;

  createEffect(() => {
    if (!props.open) {
      wasOpen = false;
      setPreviewOpen(false);
      return;
    }
    if (wasOpen) return;
    wasOpen = true;
    if (!settingsInitialized) {
      settingsInitialized = true;
      const stored = loadPrintSettings(props.documentId);
      const nextDirection =
        props.directions.find((candidate) => candidate.id === stored?.directionId) ??
        props.directions.find(
          (candidate) => candidate.id === (props.initialDirectionId ?? directionId()),
        ) ??
        props.directions[0];
      if (nextDirection) {
        const maximum = Math.max(1, Math.floor(nextDirection.count));
        const current = boundedSlice(nextDirection.current, maximum, 1);
        const nextFrom = boundedSlice(stored?.fromSlice, maximum, current);
        const nextTo = boundedSlice(stored?.toSlice, maximum, current);
        setDirectionId(nextDirection.id);
        setFromSlice(nextFrom);
        setToSlice(nextTo);
        setFromSliceText(String(nextFrom));
        setToSliceText(String(nextTo));
        previousDirectionId = nextDirection.id;
      }
      setImagesPerPage(
        Math.min(
          nextDirection?.id === 'grid'
            ? MEDICAL_IMAGE_PRINT_GRID_MAX_IMAGES_PER_PAGE
            : MEDICAL_IMAGE_PRINT_MAX_IMAGES_PER_PAGE,
          Math.max(1, Math.round(stored?.imagesPerPage ?? 1)),
        ) as MedicalImagePrintLayout,
      );
      setIncludeAnnotations(stored?.includeAnnotations ?? true);
    }
    setCaptureError(null);
  });

  createEffect(() => {
    const current = direction();
    if (previousDirectionId === current.id) return;
    previousDirectionId = current.id;
    const currentSlice = Math.min(sliceMaximum(), Math.max(1, Math.round(current.current)));
    setFromSlice(currentSlice);
    setToSlice(currentSlice);
    setFromSliceText(String(currentSlice));
    setToSliceText(String(currentSlice));
  });

  createEffect(() => {
    const maximum = imagesPerPageMaximum();
    if (imagesPerPage() > maximum) setImagesPerPage(maximum);
  });

  createEffect(() => {
    if (!props.open) {
      captureAbortController?.abort();
      captureAbortController = undefined;
      captureGeneration += 1;
      setCapturing(false);
      return;
    }
    const selectedDirectionId = directionId();
    const currentDirection = untrack(() => directionValue(props.directions, selectedDirectionId));
    const slices = medicalImagePrintSlices(fromSlice(), toSlice(), 1, currentDirection.count);
    const annotations = includeAnnotations();
    if (slices.length === 0) return;
    captureAbortController?.abort();
    const controller = new AbortController();
    captureAbortController = controller;
    const generation = ++captureGeneration;
    if (captureTimer !== undefined) window.clearTimeout(captureTimer);
    setCaptureError(null);
    captureTimer = window.setTimeout(() => {
      captureTimer = undefined;
      setCapturing(true);
      void props
        .capture({
          directionId: currentDirection.id,
          slices,
          includeAnnotations: annotations,
          signal: controller.signal,
        })
        .then((nextFrames) => {
          if (generation !== captureGeneration) return;
          if (nextFrames.length === 0) {
            setCapturing(false);
            setCaptureError('Выберите доступные срезы.');
            return;
          }
          const nextKeys = nextFrames.map(frameKey);
          setCapturedFrames(nextFrames);
          setSelectedFrameKeys(nextKeys);
          setCapturing(false);
        })
        .catch((cause: unknown) => {
          if (generation !== captureGeneration) return;
          setCapturing(false);
          setCaptureError(cause instanceof Error ? cause.message : 'Не удалось подготовить кадры.');
        })
        .finally(() => {
          if (captureAbortController === controller) captureAbortController = undefined;
        });
    }, 180);
    onCleanup(() => {
      if (captureTimer !== undefined) {
        window.clearTimeout(captureTimer);
        captureTimer = undefined;
      }
    });
  });

  createEffect(() => {
    if (!settingsInitialized) return;
    const settings: StoredPrintSettings = {
      directionId: directionId(),
      fromSlice: fromSlice(),
      toSlice: toSlice(),
      imagesPerPage: imagesPerPage(),
      includeAnnotations: includeAnnotations(),
    };
    if (settingsSaveTimer !== undefined) window.clearTimeout(settingsSaveTimer);
    settingsSaveTimer = window.setTimeout(() => {
      settingsSaveTimer = undefined;
      savePrintSettings(props.documentId, settings);
    }, 120);
    onCleanup(() => {
      if (settingsSaveTimer !== undefined) {
        window.clearTimeout(settingsSaveTimer);
        settingsSaveTimer = undefined;
      }
    });
  });

  const setSliceValue = (
    setter: (value: number) => void,
    textSetter: (value: string) => void,
    value: number,
  ): void => {
    const bounded = Math.min(sliceMaximum(), Math.max(1, Math.round(value)));
    setter(bounded);
    textSetter(String(bounded));
  };

  const setSliceNumber = (
    setter: (value: number) => void,
    textSetter: (value: string) => void,
    value: string,
  ): void => {
    textSetter(value);
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      setter(Math.min(sliceMaximum(), Math.max(1, parsed)));
    }
  };

  const commitSliceNumber = (
    getter: () => number,
    textGetter: () => string,
    textSetter: (value: string) => void,
  ): void => {
    const parsed = Number.parseInt(textGetter(), 10);
    if (!Number.isFinite(parsed)) {
      textSetter(String(getter()));
      return;
    }
    textSetter(String(Math.min(sliceMaximum(), Math.max(1, parsed))));
  };

  const setPageCount = (value: string): void => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      setImagesPerPage(
        Math.min(imagesPerPageMaximum(), Math.max(1, parsed)) as MedicalImagePrintLayout,
      );
    }
  };

  const toggleFrame = (frame: MedicalImagePrintFrame): void => {
    const key = frameKey(frame);
    setSelectedFrameKeys((current) =>
      current.includes(key) ? current.filter((candidate) => candidate !== key) : [...current, key],
    );
  };

  const applyGallerySelection = (index: number): void => {
    const drag = galleryDrag;
    const frame = capturedFrames()[index];
    if (!drag || !frame || drag.visited.has(index)) return;
    drag.visited.add(index);
    const key = frameKey(frame);
    setSelectedFrameKeys((current) =>
      drag.targetSelected
        ? current.includes(key)
          ? current
          : [...current, key]
        : current.filter((candidate) => candidate !== key),
    );
  };

  const beginGallerySelection = (event: PointerEvent): void => {
    if (!event.isPrimary || capturing()) return;
    const target = event.currentTarget as HTMLElement;
    const index = Number(target.getAttribute('data-gallery-index'));
    const frame = capturedFrames()[index];
    if (!frame) return;
    event.preventDefault();
    target.setPointerCapture(event.pointerId);
    suppressGalleryClick = true;
    galleryDrag = {
      pointerId: event.pointerId,
      targetSelected: !selectedFrameKeys().includes(frameKey(frame)),
      target,
      visited: new Set<number>(),
    };
    applyGallerySelection(index);
  };

  const galleryIndexAt = (clientX: number, clientY: number): number | undefined => {
    const card = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>('[data-gallery-index]');
    if (!card?.closest('.medical-image-print-dialog__gallery-grid')) return undefined;
    const index = Number(card.getAttribute('data-gallery-index'));
    return Number.isInteger(index) ? index : undefined;
  };

  const handleGalleryPointerMove = (event: PointerEvent): void => {
    const drag = galleryDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const index = galleryIndexAt(event.clientX, event.clientY);
    if (index === undefined || drag.visited.has(index)) return;
    applyGallerySelection(index);
  };

  const finishGallerySelection = (event?: PointerEvent): void => {
    const drag = galleryDrag;
    if (!drag || (event && drag.pointerId !== event.pointerId)) return;
    if (drag.target.hasPointerCapture(drag.pointerId)) {
      drag.target.releasePointerCapture(drag.pointerId);
    }
    galleryDrag = undefined;
    window.setTimeout(() => {
      suppressGalleryClick = false;
    }, 0);
  };

  const print = (): void => {
    const currentFrames = frames();
    if (currentFrames.length === 0) return;
    const options: MedicalImagePrintOptions = {
      imagesPerPage: imagesPerPage(),
      includeAnnotations: includeAnnotations(),
    };
    if (
      !PrintManager.html(
        buildMedicalImagePrintHtml(props.title, currentFrames, options),
        props.title,
      )
    ) {
      setCaptureError('Не удалось открыть окно печати. Разрешите всплывающие окна для MiniMed.');
      return;
    }
    props.onClose();
  };

  const togglePreview = (): void => {
    setPreviewOpen((open) => !open);
  };

  return (
    <>
      <OverlayDialog
        open={props.open}
        title="Печать снимков"
        subtitle={`${props.title} · выбрано ${String(frames().length || selectedSlices().length)} кадр.`}
        class="medical-image-print-dialog"
        bodyClass="medical-image-print-dialog__body"
        headerStart={
          <Button
            type="button"
            variant="icon"
            class="medical-image-print-dialog__header-print-button"
            aria-label="Печатать выбранные кадры"
            title="Печатать выбранные кадры"
            disabled={capturing() || frames().length === 0}
            onClick={print}
            icon={<AppGlyph name="printer" class="medical-image-print-dialog__header-icon" />}
          />
        }
        headerEnd={
          <button
            type="button"
            class="medical-image-print-dialog__header-preview"
            aria-expanded={previewOpen()}
            aria-controls={fieldId('preview')}
            aria-label={previewOpen() ? 'Скрыть лист A4' : 'Показать лист A4'}
            title={previewOpen() ? 'Скрыть лист A4' : 'Показать лист A4'}
            onClick={togglePreview}
          >
            <span class="medical-image-print-dialog__header-preview-media">
              <Show
                when={previewFrame()}
                fallback={
                  <AppGlyph
                    name="frame-corners"
                    class="medical-image-print-dialog__header-preview-icon"
                  />
                }
              >
                {(frame) => (
                  <img
                    class="medical-image-print-dialog__header-preview-image"
                    src={frame().dataUrl}
                    alt=""
                  />
                )}
              </Show>
            </span>
            <span class="medical-image-print-dialog__header-preview-copy">
              <strong class="medical-image-print-dialog__header-preview-title">Лист A4</strong>
              <small class="medical-image-print-dialog__header-preview-count">
                {String(frames().length)} кадр.
              </small>
            </span>
          </button>
        }
        onClose={props.onClose}
      >
        <div class="medical-image-print-dialog__layout">
          <section class="medical-image-print-dialog__settings" aria-label="Параметры печати">
            <div class="medical-image-print-dialog__direction-heading">
              <span class="medical-image-print-dialog__label">Направление</span>
              <span class="medical-image-print-dialog__direction-count">
                {String(direction().count)} срезов
              </span>
            </div>
            <div class="medical-image-print-dialog__directions">
              <For each={props.directions}>
                {(candidate) => (
                  <Button
                    type="button"
                    variant={directionId() === candidate.id ? 'primary' : 'secondary'}
                    class="medical-image-print-dialog__direction-button"
                    aria-pressed={directionId() === candidate.id}
                    aria-label={candidate.label}
                    title={candidate.label}
                    onClick={() => setDirectionId(candidate.id)}
                    icon={
                      <AppGlyph
                        name={candidate.icon}
                        class="medical-image-print-dialog__direction-icon"
                      />
                    }
                  />
                )}
              </For>
            </div>

            <fieldset class="medical-image-print-dialog__slice-range" aria-label="Диапазон срезов">
              <div class="medical-image-print-dialog__range-heading">
                <span class="medical-image-print-dialog__label">Срезы</span>
                <output class="medical-image-print-dialog__range-value">
                  {String(fromSlice())}–{String(toSlice())} из {String(direction().count)}
                </output>
              </div>
              <div
                class="medical-image-print-dialog__range-track"
                style={{
                  '--medical-image-print-range-start': `${String(
                    ((Math.min(fromSlice(), toSlice()) - 1) / Math.max(1, sliceMaximum() - 1)) *
                      100,
                  )}%`,
                  '--medical-image-print-range-end': `${String(
                    ((Math.max(fromSlice(), toSlice()) - 1) / Math.max(1, sliceMaximum() - 1)) *
                      100,
                  )}%`,
                }}
              >
                <input
                  class="medical-image-print-dialog__range-input medical-image-print-dialog__range-input--from"
                  type="range"
                  min="1"
                  max={sliceMaximum()}
                  step="1"
                  value={fromSlice()}
                  aria-label="Срез от"
                  onInput={(event) =>
                    setSliceValue(setFromSlice, setFromSliceText, Number(event.currentTarget.value))
                  }
                />
                <input
                  class="medical-image-print-dialog__range-input medical-image-print-dialog__range-input--to"
                  type="range"
                  min="1"
                  max={sliceMaximum()}
                  step="1"
                  value={toSlice()}
                  aria-label="Срез до"
                  onInput={(event) =>
                    setSliceValue(setToSlice, setToSliceText, Number(event.currentTarget.value))
                  }
                />
              </div>
              <div class="medical-image-print-dialog__range-inputs">
                <label class="medical-image-print-dialog__field" for={fieldId('from')}>
                  <span class="medical-image-print-dialog__range-label">От</span>
                  <input
                    id={fieldId('from')}
                    class="medical-image-print-dialog__input"
                    type="number"
                    min="1"
                    max={sliceMaximum()}
                    value={fromSliceText()}
                    onInput={(event) =>
                      setSliceNumber(setFromSlice, setFromSliceText, event.currentTarget.value)
                    }
                    onBlur={() => commitSliceNumber(fromSlice, fromSliceText, setFromSliceText)}
                  />
                </label>
                <label class="medical-image-print-dialog__field" for={fieldId('to')}>
                  <span class="medical-image-print-dialog__range-label">До</span>
                  <input
                    id={fieldId('to')}
                    class="medical-image-print-dialog__input"
                    type="number"
                    min="1"
                    max={sliceMaximum()}
                    value={toSliceText()}
                    onInput={(event) =>
                      setSliceNumber(setToSlice, setToSliceText, event.currentTarget.value)
                    }
                    onBlur={() => commitSliceNumber(toSlice, toSliceText, setToSliceText)}
                  />
                </label>
              </div>
            </fieldset>
            <fieldset
              class="medical-image-print-dialog__page-range"
              aria-label="Снимков на странице"
            >
              <div class="medical-image-print-dialog__range-heading">
                <span class="medical-image-print-dialog__label">Снимков на странице</span>
                <output class="medical-image-print-dialog__range-value">
                  {String(imagesPerPage())} из {String(imagesPerPageMaximum())}
                </output>
              </div>
              <input
                class="medical-image-print-dialog__page-range-input"
                type="range"
                min="1"
                max={imagesPerPageMaximum()}
                step="1"
                value={imagesPerPage()}
                aria-label="Количество снимков на странице"
                onInput={(event) => setPageCount(event.currentTarget.value)}
              />
            </fieldset>

            <fieldset class="medical-image-print-dialog__switches">
              <legend class="medical-image-print-dialog__label">Состав печати</legend>
              <div class="medical-image-print-dialog__switch-row">
                <span>Пометки на снимках</span>
                <Switch
                  checked={includeAnnotations()}
                  onChange={setIncludeAnnotations}
                  aria-label="Добавлять пометки на снимках"
                />
              </div>
            </fieldset>

            <p class="medical-image-print-dialog__hint">
              Выберите кадры в галерее. Пациент, серия и номер среза останутся поверх снимка.
            </p>
            <Show when={captureError()}>
              {(message) => (
                <p class="medical-image-print-dialog__error" role="alert">
                  {message()}
                </p>
              )}
            </Show>
          </section>

          <section class="medical-image-print-dialog__gallery-panel" aria-label="Галерея срезов">
            <button
              type="button"
              class="medical-image-print-dialog__gallery-toggle"
              aria-expanded={galleryOpen()}
              onClick={() => setGalleryOpen((open) => !open)}
            >
              <span class="medical-image-print-dialog__gallery-heading">Галерея срезов</span>
              <span class="medical-image-print-dialog__gallery-toggle-meta">
                {String(frames().length)} из {String(capturedFrames().length)} выбрано
                <AppGlyph
                  name="caret-down"
                  class={`medical-image-print-dialog__gallery-toggle-icon${galleryOpen() ? ' medical-image-print-dialog__gallery-toggle-icon--open' : ''}`}
                />
              </span>
            </button>
            <Show when={galleryOpen()}>
              <div class="medical-image-print-dialog__gallery-content">
                <p class="medical-image-print-dialog__gallery-hint">
                  Нажмите или зажмите мышь/палец и проведите по кадрам для группового выбора.
                </p>
                <div
                  class="medical-image-print-dialog__gallery-grid"
                  onPointerMove={handleGalleryPointerMove}
                  onPointerUp={finishGallerySelection}
                  onPointerCancel={finishGallerySelection}
                >
                  <For each={capturedFrames()}>
                    {(frame, index) => {
                      const selected = (): boolean => selectedFrameKeySet().has(frameKey(frame));
                      const overlay = (): ReturnType<typeof medicalImagePrintOverlay> =>
                        medicalImagePrintOverlay(frame);
                      return (
                        <button
                          type="button"
                          class="medical-image-print-dialog__gallery-card"
                          classList={{
                            'medical-image-print-dialog__gallery-card--selected': selected(),
                          }}
                          data-gallery-index={index()}
                          aria-pressed={selected()}
                          disabled={capturing()}
                          title={`${overlay().bottom}: ${selected() ? 'убрать из печати' : 'добавить в печать'}`}
                          onPointerDown={beginGallerySelection}
                          onClick={() => {
                            if (suppressGalleryClick) return;
                            toggleFrame(frame);
                          }}
                        >
                          <img
                            class="medical-image-print-dialog__gallery-image"
                            src={frame.dataUrl}
                            alt=""
                            loading="lazy"
                            decoding="async"
                          />
                          <span class="medical-image-print-dialog__gallery-label">
                            {overlay().bottom}
                          </span>
                        </button>
                      );
                    }}
                  </For>
                  <Show when={capturedFrames().length === 0}>
                    <p class="medical-image-print-dialog__gallery-empty">
                      {capturing() ? 'Рендерим выбранные кадры…' : 'Выберите доступные срезы.'}
                    </p>
                  </Show>
                </div>
              </div>
            </Show>
          </section>
        </div>
      </OverlayDialog>
      <Show when={props.open && previewOpen()}>
        <Portal>
          <aside
            id={fieldId('preview')}
            class="medical-image-print-dialog__preview"
            aria-label="Предпросмотр печати"
          >
            <div class="medical-image-print-dialog__preview-heading">
              <strong>Лист A4</strong>
              <span class="medical-image-print-dialog__preview-page-count">
                {frames().length > imagesPerPage()
                  ? `1 из ${String(Math.ceil(frames().length / imagesPerPage()))} страниц`
                  : '1 страница'}
              </span>
              <Button
                type="button"
                variant="icon"
                class="medical-image-print-dialog__preview-close"
                aria-label="Скрыть предпросмотр"
                title="Скрыть предпросмотр"
                onClick={() => setPreviewOpen(false)}
                icon={<AppGlyph name="close" class="medical-image-print-dialog__button-icon" />}
              />
            </div>
            <div class="medical-image-print-dialog__preview-sheet">
              <div
                class="medical-image-print-dialog__preview-grid"
                classList={{
                  'medical-image-print-dialog__preview-grid--single': imagesPerPage() === 1,
                }}
                style={{ '--medical-image-print-columns': String(previewColumns()) }}
              >
                <Show
                  when={!capturing() && previewFrames().length > 0}
                  fallback={
                    <p class="medical-image-print-dialog__preview-empty">
                      {capturing() ? 'Рендерим выбранные кадры…' : 'Выберите кадры в галерее.'}
                    </p>
                  }
                >
                  <For each={previewFrames()}>
                    {(frame) => {
                      const overlay = medicalImagePrintOverlay(frame);
                      return (
                        <figure
                          class="medical-image-print-dialog__preview-frame"
                          classList={{
                            'medical-image-print-dialog__preview-frame--single':
                              imagesPerPage() === 1,
                            'medical-image-print-dialog__preview-frame--grid':
                              frame.directionLabel.includes('· сетка'),
                          }}
                        >
                          <div
                            class="medical-image-print-dialog__preview-media"
                            classList={{
                              'medical-image-print-dialog__preview-media--grid':
                                frame.directionLabel.includes('· сетка'),
                            }}
                          >
                            <img
                              class="medical-image-print-dialog__preview-image"
                              src={frame.dataUrl}
                              alt={`${frame.directionLabel}, ${frame.sliceLabel}`}
                            />
                            <Show when={includeAnnotations() && frame.annotationSvg}>
                              {(annotation) => (
                                <div
                                  class="medical-image-print-dialog__preview-annotation"
                                  innerHTML={annotation()}
                                />
                              )}
                            </Show>
                            <div
                              class="medical-image-print-dialog__preview-overlay"
                              classList={{
                                'medical-image-print-dialog__preview-overlay--grid':
                                  frame.directionLabel.includes('· сетка'),
                              }}
                            >
                              <span class="medical-image-print-dialog__preview-overlay-top">
                                {overlay.top}
                              </span>
                              <span class="medical-image-print-dialog__preview-overlay-bottom">
                                {overlay.bottom}
                              </span>
                            </div>
                          </div>
                        </figure>
                      );
                    }}
                  </For>
                </Show>
              </div>
            </div>
            <Show when={frames().length > imagesPerPage()}>
              <p class="medical-image-print-dialog__preview-more">
                Ещё {String(frames().length - imagesPerPage())} кадр. Они попадут на следующие
                страницы.
              </p>
            </Show>
          </aside>
        </Portal>
      </Show>
    </>
  );
}
