import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { EcgPointTools } from './EcgPointTools';
import type { EcgNormalizedPoint } from './ecg-model-contract';
import {
  ECG_POINT_LABELS,
  type EcgCalibrationLine,
  type EcgEditorPoint,
  type EcgLeadRegion,
  type EcgPointKind,
  ecgRegionLabel,
  moveEcgRegion,
} from './ecgEditor';
import { extractEcgEditorRegion } from './ecgReviewExtraction';
import type { EcgEditor } from './useEcgEditor';
import { useEcgViewport } from './useEcgViewport';

type CalibrationAxis = 'horizontal' | 'vertical';
type RegionCorner = 'tl' | 'tr' | 'bl' | 'br';
type Gesture =
  | { readonly type: 'point'; readonly pointerId: number; readonly value: EcgEditorPoint }
  | {
      readonly type: 'region';
      readonly pointerId: number;
      readonly origin: EcgNormalizedPoint;
      readonly initial: EcgLeadRegion;
      readonly value: EcgLeadRegion;
      readonly corner?: RegionCorner;
    }
  | {
      readonly type: 'calibration';
      readonly pointerId: number;
      readonly axis: CalibrationAxis;
      readonly value: EcgCalibrationLine;
      readonly end: 'start' | 'end';
    };

const clamp = (n: number): number => Math.max(0, Math.min(1, n));
export function EcgEditorCanvas(props: {
  readonly editor: EcgEditor;
  readonly calibrationTool: CalibrationAxis | 'pan';
  readonly onCalibrationDone: () => void;
}): JSX.Element {
  const e = props.editor;
  const size = () => ({ width: e.photo()?.width ?? 1000, height: e.photo()?.height ?? 700 });
  const viewport = useEcgViewport(size);
  const [gesture, setGesture] = createSignal<Gesture>();
  const [selectedPoint, setSelectedPoint] = createSignal<string>();
  const [canvasSize, setCanvasSize] = createSignal({ width: 1000, height: 700 });
  let svg: SVGSVGElement | undefined;
  const displayScale = () =>
    Math.min(
      canvasSize().width / (viewport.view().width * size().width),
      canvasSize().height / (viewport.view().height * size().height),
    );
  const radius = () => 5 / displayScale();
  const hitRadius = () => 22 / displayScale();
  const fontSize = () => 12 / displayScale();
  const pointAt = (event: PointerEvent): EcgNormalizedPoint => {
    const point = viewport.point(event.clientX, event.clientY);
    return { x: clamp(point.x), y: clamp(point.y) };
  };
  const activeRegion = () => e.draft().regions.find((r) => r.id === e.activeRegion());
  const extraction = createMemo(() => {
    const maps = e.maps();
    const region = activeRegion();
    return maps && region && e.step() === 4
      ? extractEcgEditorRegion(maps, region, e.draft().calibration)
      : undefined;
  });
  createEffect(() => {
    e.photo();
    viewport.reset();
    setSelectedPoint(undefined);
  });
  createEffect(() => {
    e.activeRegion();
    setSelectedPoint(undefined);
  });
  const capture = (event: PointerEvent, next: Gesture): void => {
    event.preventDefault();
    event.stopPropagation();
    svg?.setPointerCapture(event.pointerId);
    setGesture(next);
  };
  const displayedPoint = (point: EcgEditorPoint): EcgEditorPoint => {
    const current = gesture();
    return current?.type === 'point' && current.value.id === point.id ? current.value : point;
  };
  const displayedRegion = (region: EcgLeadRegion): EcgLeadRegion => {
    const current = gesture();
    return current?.type === 'region' && current.value.id === region.id ? current.value : region;
  };
  const calibration = (axis: CalibrationAxis): EcgCalibrationLine | undefined => {
    const current = gesture();
    return current?.type === 'calibration' && current.axis === axis
      ? current.value
      : e.draft().calibration[axis];
  };
  const begin = (event: PointerEvent): void => {
    if (e.step() === 2 && props.calibrationTool !== 'pan' && event.button === 0) {
      const p = pointAt(event);
      capture(event, {
        type: 'calibration',
        pointerId: event.pointerId,
        axis: props.calibrationTool,
        value: { start: p, end: p },
        end: 'end',
      });
    } else viewport.down(event);
  };
  const move = (event: PointerEvent): void => {
    const current = gesture();
    if (!current || current.pointerId !== event.pointerId) {
      viewport.move(event);
      return;
    }
    event.preventDefault();
    const p = pointAt(event);
    if (current.type === 'point') {
      const region = e.draft().regions.find((r) => r.id === current.value.regionId);
      if (!region) return;
      setGesture({
        ...current,
        value: {
          ...current.value,
          x: Math.max(region.x, Math.min(region.x + region.width, p.x)),
          y: Math.max(region.y, Math.min(region.y + region.height, p.y)),
          source: 'manual',
        },
      });
    } else if (current.type === 'calibration') {
      const other = current.value[current.end === 'start' ? 'end' : 'start'];
      setGesture({
        ...current,
        value: {
          ...current.value,
          [current.end]:
            current.axis === 'horizontal' ? { x: p.x, y: other.y } : { x: other.x, y: p.y },
        },
      });
    } else {
      const r = current.initial;
      if (!current.corner)
        setGesture({
          ...current,
          value: moveEcgRegion(r, p.x - current.origin.x, p.y - current.origin.y),
        });
      else {
        const left = current.corner.endsWith('l') ? Math.min(p.x, r.x + r.width - 0.01) : r.x;
        const top = current.corner.startsWith('t') ? Math.min(p.y, r.y + r.height - 0.01) : r.y;
        const right = current.corner.endsWith('r') ? Math.max(p.x, r.x + 0.01) : r.x + r.width;
        const bottom = current.corner.startsWith('b') ? Math.max(p.y, r.y + 0.01) : r.y + r.height;
        setGesture({
          ...current,
          value: { ...r, x: left, y: top, width: right - left, height: bottom - top },
        });
      }
    }
  };
  const finish = (event: PointerEvent, cancel = false): void => {
    const current = gesture();
    if (!current || current.pointerId !== event.pointerId) {
      viewport.up(event);
      return;
    }
    if (svg?.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (!cancel) {
      const draft = e.draft();
      if (current.type === 'point')
        e.commit({
          ...draft,
          points: draft.points.map((p) => (p.id === current.value.id ? current.value : p)),
        });
      else if (current.type === 'region')
        e.commit({
          ...draft,
          regions: draft.regions.map((r) => (r.id === current.value.id ? current.value : r)),
        });
      else {
        e.commit({
          ...draft,
          calibration: { ...draft.calibration, [current.axis]: current.value },
        });
        props.onCalibrationDone();
      }
    }
    setGesture(undefined);
  };
  const addPoint = (kind: EcgPointKind): void => {
    const region = activeRegion();
    if (!region) return;
    const view = viewport.view();
    const point: EcgEditorPoint = {
      id: crypto.randomUUID(),
      kind,
      regionId: region.id,
      source: 'manual',
      x: Math.max(region.x, Math.min(region.x + region.width, view.x + view.width / 2)),
      y: Math.max(region.y, Math.min(region.y + region.height, view.y + view.height / 2)),
    };
    e.commit({ ...e.draft(), points: [...e.draft().points, point] });
    setSelectedPoint(point.id);
  };
  const removePoint = (): void => {
    e.commit({ ...e.draft(), points: e.draft().points.filter((p) => p.id !== selectedPoint()) });
    setSelectedPoint(undefined);
  };
  const keyDelta = (event: KeyboardEvent): EcgNormalizedPoint | undefined => {
    const directions: Record<string, readonly [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = directions[event.key];
    if (!d) return undefined;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    return { x: (d[0] * step) / size().width, y: (d[1] * step) / size().height };
  };
  const moveSelected = (event: KeyboardEvent, point: EcgEditorPoint): void => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      setSelectedPoint(point.id);
      removePoint();
      return;
    }
    const d = keyDelta(event);
    if (!d) return;
    const region = e.draft().regions.find((r) => r.id === point.regionId);
    if (!region) return;
    e.commit({
      ...e.draft(),
      points: e.draft().points.map((p) =>
        p.id === point.id
          ? {
              ...p,
              x: Math.max(region.x, Math.min(region.x + region.width, p.x + d.x)),
              y: Math.max(region.y, Math.min(region.y + region.height, p.y + d.y)),
              source: 'manual',
            }
          : p,
      ),
    });
    queueMicrotask(() =>
      svg?.querySelector<SVGCircleElement>(`[data-point-id="${CSS.escape(point.id)}"]`)?.focus(),
    );
  };
  return (
    <div class="ecg-editor__canvas-wrap">
      <svg
        class="ecg-editor__canvas"
        role="application"
        aria-label="Фотография ЭКГ и разметка"
        viewBox={viewport.viewBox()}
        ref={(element) => {
          svg = element;
          viewport.ref(element);
          const observer = new ResizeObserver((entries) => {
            const rect = entries[0]?.contentRect;
            if (rect) setCanvasSize({ width: rect.width, height: rect.height });
          });
          observer.observe(element);
          onCleanup(() => observer.disconnect());
        }}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={(event) => finish(event)}
        onPointerCancel={(event) => finish(event, true)}
        onWheel={viewport.wheel}
      >
        <image
          class="ecg-editor__photo"
          href={e.photo()?.url}
          width={size().width}
          height={size().height}
        />
        <Show when={e.step() === 3 || e.step() === 4}>
          <For each={e.draft().regions}>
            {(region) => {
              const r = () => displayedRegion(region);
              return (
                <g class="ecg-editor__region-group">
                  {/* biome-ignore lint/a11y/useSemanticElements: Interactive SVG regions cannot be HTML buttons. */}
                  <rect
                    class="ecg-editor__region"
                    classList={{
                      'ecg-editor__region--active': region.id === e.activeRegion(),
                      'ecg-editor__region--editable': e.step() === 3,
                    }}
                    x={r().x * size().width}
                    y={r().y * size().height}
                    width={r().width * size().width}
                    height={r().height * size().height}
                    role="button"
                    tabindex={e.step() === 3 ? 0 : -1}
                    aria-label={`Область ${ecgRegionLabel(region)}`}
                    onPointerDown={(event) => {
                      e.setActiveRegion(region.id);
                      if (e.step() === 3)
                        capture(event, {
                          type: 'region',
                          pointerId: event.pointerId,
                          origin: pointAt(event),
                          initial: region,
                          value: region,
                        });
                    }}
                    onKeyDown={(event) => {
                      const d = keyDelta(event);
                      if (d)
                        e.commit({
                          ...e.draft(),
                          regions: e
                            .draft()
                            .regions.map((value) =>
                              value.id === region.id ? moveEcgRegion(value, d.x, d.y) : value,
                            ),
                        });
                    }}
                  />
                  <Show when={e.step() === 3}>
                    <text
                      class="ecg-editor__region-label"
                      x={r().x * size().width + fontSize() / 2}
                      y={r().y * size().height + fontSize() * 1.4}
                      font-size={String(fontSize())}
                    >
                      {ecgRegionLabel(region)}
                    </text>
                    <Show when={region.id === e.activeRegion()}>
                      <For each={['tl', 'tr', 'bl', 'br'] as const}>
                        {(corner) => (
                          <circle
                            class="ecg-editor__resize-handle"
                            cx={(r().x + (corner.endsWith('r') ? r().width : 0)) * size().width}
                            cy={(r().y + (corner.startsWith('b') ? r().height : 0)) * size().height}
                            r={hitRadius()}
                            onPointerDown={(event) =>
                              capture(event, {
                                type: 'region',
                                pointerId: event.pointerId,
                                origin: pointAt(event),
                                initial: region,
                                value: region,
                                corner,
                              })
                            }
                          />
                        )}
                      </For>
                    </Show>
                  </Show>
                </g>
              );
            }}
          </For>
        </Show>
        <Show when={e.step() === 2}>
          <For each={['horizontal', 'vertical'] as const}>
            {(axis) => (
              <Show when={calibration(axis)}>
                {(line) => (
                  <g class="ecg-editor__calibration-group">
                    <line
                      class="ecg-editor__calibration-line"
                      x1={line().start.x * size().width}
                      y1={line().start.y * size().height}
                      x2={line().end.x * size().width}
                      y2={line().end.y * size().height}
                    />
                    <text
                      class="ecg-editor__calibration-label"
                      x={line().start.x * size().width}
                      y={line().start.y * size().height - fontSize()}
                      font-size={String(fontSize())}
                    >
                      {axis === 'horizontal' ? '25 мм' : '10 мм'}
                    </text>
                    <For each={['start', 'end'] as const}>
                      {(end) => (
                        // biome-ignore lint/a11y/useSemanticElements: SVG calibration handles support keyboard movement.
                        <circle
                          class="ecg-editor__calibration-handle"
                          cx={line()[end].x * size().width}
                          cy={line()[end].y * size().height}
                          r={hitRadius()}
                          role="button"
                          tabindex={0}
                          aria-label={`${axis === 'horizontal' ? 'Горизонтальная' : 'Вертикальная'} калибровка: ${end === 'start' ? 'начало' : 'конец'}`}
                          onPointerDown={(event) =>
                            props.calibrationTool === 'pan' &&
                            capture(event, {
                              type: 'calibration',
                              axis,
                              value: line(),
                              end,
                              pointerId: event.pointerId,
                            })
                          }
                          onKeyDown={(event) => {
                            const d = keyDelta(event);
                            if (!d) return;
                            const previous = line()[end];
                            e.commit({
                              ...e.draft(),
                              calibration: {
                                ...e.draft().calibration,
                                [axis]: {
                                  ...line(),
                                  [end]: {
                                    x: clamp(previous.x + (axis === 'horizontal' ? d.x : 0)),
                                    y: clamp(previous.y + (axis === 'vertical' ? d.y : 0)),
                                  },
                                },
                              },
                            });
                          }}
                        />
                      )}
                    </For>
                  </g>
                )}
              </Show>
            )}
          </For>
        </Show>
        <Show when={e.step() === 4}>
          <path
            class="ecg-editor__trace"
            d={extraction()?.path ?? ''}
            transform={`scale(${size().width / 1000} ${size().height / 1000})`}
          />
          <For
            each={e
              .draft()
              .points.filter((p) => p.regionId === e.activeRegion())
              .sort((a, b) => Number(a.id === selectedPoint()) - Number(b.id === selectedPoint()))}
          >
            {(original) => {
              const p = () => displayedPoint(original);
              return (
                <g class="ecg-editor__point-group">
                  {/* biome-ignore lint/a11y/useSemanticElements: SVG point handles support keyboard movement. */}
                  <circle
                    class="ecg-editor__point-hit"
                    cx={p().x * size().width}
                    cy={p().y * size().height}
                    r={hitRadius()}
                    role="button"
                    tabindex={0}
                    aria-label={`${ECG_POINT_LABELS[original.kind]}, ${original.source === 'auto' ? 'автоматическая точка' : 'ручная точка'}`}
                    aria-pressed={selectedPoint() === original.id}
                    data-point-id={original.id}
                    onFocus={() => setSelectedPoint(original.id)}
                    onKeyDown={(event) => moveSelected(event, original)}
                    onPointerDown={(event) => {
                      setSelectedPoint(original.id);
                      capture(event, {
                        type: 'point',
                        pointerId: event.pointerId,
                        value: original,
                      });
                    }}
                  />
                  <circle
                    class="ecg-editor__point"
                    classList={{ 'ecg-editor__point--selected': selectedPoint() === original.id }}
                    cx={p().x * size().width}
                    cy={p().y * size().height}
                    r={radius()}
                  />
                  <Show when={selectedPoint() === original.id}>
                    <text
                      class="ecg-editor__point-label"
                      x={p().x * size().width + fontSize()}
                      y={p().y * size().height - fontSize()}
                      font-size={String(fontSize())}
                    >
                      {ECG_POINT_LABELS[original.kind]}
                    </text>
                  </Show>
                </g>
              );
            }}
          </For>
        </Show>
      </svg>
      <Show when={e.step() >= 3}>
        <EcgPointTools
          editor={e}
          selectedPoint={selectedPoint()}
          onSelectPoint={(id) => {
            setSelectedPoint(id);
            queueMicrotask(() =>
              svg?.querySelector<SVGCircleElement>(`[data-point-id="${CSS.escape(id)}"]`)?.focus(),
            );
          }}
          onAdd={addPoint}
          onFocus={() => {
            const region = activeRegion();
            if (region) viewport.focus(region);
          }}
          onDelete={removePoint}
        />
      </Show>
      <div class="ecg-editor__history-tools">
        <button
          class="ecg-editor__icon-button"
          type="button"
          aria-label="Отменить изменение"
          title="Отменить изменение"
          disabled={!e.canUndo()}
          onClick={e.undo}
        >
          <AppGlyph class="ecg-editor__icon" name="arrow-u-up-left" />
        </button>
        <button
          class="ecg-editor__icon-button"
          type="button"
          aria-label="Повторить изменение"
          title="Повторить изменение"
          disabled={!e.canRedo()}
          onClick={e.redo}
        >
          <AppGlyph class="ecg-editor__icon" name="arrow-u-up-right" />
        </button>
      </div>
      <div class="ecg-editor__zoom-tools">
        <button
          class="ecg-editor__icon-button"
          type="button"
          aria-label="Уменьшить ЭКГ"
          title="Уменьшить"
          onClick={() => viewport.zoom(1 / 1.5)}
        >
          <AppGlyph class="ecg-editor__icon" name="minus" />
        </button>
        <button
          class="ecg-editor__icon-button"
          type="button"
          aria-label="Показать всю ЭКГ"
          title="Показать весь снимок"
          onClick={viewport.reset}
        >
          <AppGlyph class="ecg-editor__icon" name="arrows-in" />
        </button>
        <button
          class="ecg-editor__icon-button"
          type="button"
          aria-label="Увеличить ЭКГ"
          title="Увеличить"
          onClick={() => viewport.zoom(1.5)}
        >
          <AppGlyph class="ecg-editor__icon" name="plus" />
        </button>
      </div>
      <Show when={e.step() === 4 && selectedPoint()}>
        <div class="ecg-editor__point-nudge">
          Стрелки клавиатуры — сдвиг на 1 пиксель; Shift — на 10.
        </div>
      </Show>
    </div>
  );
}
