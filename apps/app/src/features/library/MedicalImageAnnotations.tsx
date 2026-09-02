import { createEffect, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { eraseMedicalImageStrokes } from '@/features/library/medical-image-annotation-geometry';
import {
  getUserLibraryMedicalAnnotations,
  putUserLibraryMedicalAnnotations,
  type UserLibraryMedicalAnnotationColor,
  type UserLibraryMedicalAnnotationPoint,
  type UserLibraryMedicalAnnotationStroke,
} from '@/state/user-library';

export type MedicalImageAnnotationTool = 'none' | 'pen' | 'eraser';

const VIEWBOX_SIZE = 1000;
const MIN_POINT_DISTANCE = 0.0015;

interface PendingAnnotationPoint {
  readonly point: UserLibraryMedicalAnnotationPoint;
  readonly mode: 'pen' | 'eraser';
  readonly strokeId?: string;
  readonly tolerance?: number;
}

export function MedicalImageAnnotationToolbar(props: {
  readonly tool: MedicalImageAnnotationTool;
  readonly color: UserLibraryMedicalAnnotationColor;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly showShortcuts?: boolean;
  readonly onToolChange: (tool: MedicalImageAnnotationTool) => void;
  readonly onColorChange: (color: UserLibraryMedicalAnnotationColor) => void;
}): JSX.Element {
  const selectColor = (color: UserLibraryMedicalAnnotationColor): void => {
    if (props.tool === 'pen' && props.color === color) {
      props.onToolChange('none');
      return;
    }
    props.onColorChange(color);
    props.onToolChange('pen');
  };

  return (
    <fieldset class="medical-image-viewer__tool-group">
      <legend class="medical-image-viewer__tool-group-label">Разметка снимка</legend>
      <button
        class="medical-image-viewer__annotation-color medical-image-viewer__annotation-color--red"
        classList={{
          'medical-image-viewer__annotation-color--active':
            props.tool === 'pen' && props.color === 'red',
        }}
        type="button"
        aria-label="Режим: красный карандаш (D)"
        title="Режим: красный карандаш (D)"
        aria-pressed={props.tool === 'pen' && props.color === 'red'}
        disabled={props.disabled}
        onClick={() => selectColor('red')}
      >
        <AppGlyph
          name={props.tool === 'pen' && props.color === 'red' ? 'edit-fill' : 'edit'}
          class="medical-image-viewer__annotation-color-icon"
        />
        <Show when={props.showShortcuts !== false}>
          <span class="medical-image-viewer__tool-shortcut" aria-hidden="true">
            (d)
          </span>
        </Show>
      </button>
      <button
        class="medical-image-viewer__annotation-color medical-image-viewer__annotation-color--blue"
        classList={{
          'medical-image-viewer__annotation-color--active':
            props.tool === 'pen' && props.color === 'blue',
        }}
        type="button"
        aria-label="Режим: синий карандаш (D)"
        title="Режим: синий карандаш (D)"
        aria-pressed={props.tool === 'pen' && props.color === 'blue'}
        disabled={props.disabled}
        onClick={() => selectColor('blue')}
      >
        <AppGlyph
          name={props.tool === 'pen' && props.color === 'blue' ? 'edit-fill' : 'edit'}
          class="medical-image-viewer__annotation-color-icon"
        />
        <Show when={props.showShortcuts !== false}>
          <span class="medical-image-viewer__tool-shortcut" aria-hidden="true">
            (d)
          </span>
        </Show>
      </button>
      <Button
        class="medical-image-viewer__tool medical-image-viewer__tool--icon"
        variant={props.tool === 'eraser' ? 'primary' : 'icon'}
        aria-label="Режим: ластик (E)"
        title={props.disabled ? props.disabledReason : 'Режим: ластик (E)'}
        aria-pressed={props.tool === 'eraser'}
        disabled={props.disabled}
        onClick={() => props.onToolChange(props.tool === 'eraser' ? 'none' : 'eraser')}
        icon={
          <>
            <AppGlyph name="eraser" class="medical-image-viewer__tool-icon" />
            <Show when={props.showShortcuts !== false}>
              <span class="medical-image-viewer__tool-shortcut" aria-hidden="true">
                (e)
              </span>
            </Show>
          </>
        }
      />
    </fieldset>
  );
}

export function MedicalImageAnnotationLayer(props: {
  readonly documentId: string;
  readonly sliceKey: string | null;
  readonly tool: MedicalImageAnnotationTool;
  readonly color: UserLibraryMedicalAnnotationColor;
  readonly disabled?: boolean;
}): JSX.Element {
  const [strokes, setStrokes] = createSignal<readonly UserLibraryMedicalAnnotationStroke[]>([]);
  const [error, setError] = createSignal<string>();
  let activePointerId: number | undefined;
  let activeStrokeId: string | undefined;
  let annotationBounds: DOMRect | undefined;
  let annotationFrame: number | undefined;
  let pendingPoint: PendingAnnotationPoint | undefined;
  let loadGeneration = 0;

  createEffect(() => {
    const sliceKey = props.sliceKey;
    const generation = ++loadGeneration;
    activePointerId = undefined;
    activeStrokeId = undefined;
    annotationBounds = undefined;
    pendingPoint = undefined;
    if (annotationFrame !== undefined) cancelAnimationFrame(annotationFrame);
    annotationFrame = undefined;
    setStrokes([]);
    setError(undefined);
    if (!sliceKey) return;
    void getUserLibraryMedicalAnnotations(props.documentId, sliceKey)
      .then((stored) => {
        if (generation === loadGeneration) setStrokes(stored);
      })
      .catch((cause: unknown) => {
        if (generation !== loadGeneration) return;
        setError(cause instanceof Error ? cause.message : 'Не удалось прочитать разметку.');
      });
  });

  const pointFromEvent = (
    event: PointerEvent & { readonly currentTarget: SVGSVGElement },
    bounds: DOMRect = event.currentTarget.getBoundingClientRect(),
  ): UserLibraryMedicalAnnotationPoint => {
    // ponytail: Screen-space vectors follow viewport resizing; use viewer world coordinates if marks must follow zoom/pan.
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width))),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / Math.max(1, bounds.height))),
    };
  };

  const applyPendingPoint = (): void => {
    const pending = pendingPoint;
    pendingPoint = undefined;
    if (!pending) return;
    if (pending.mode === 'eraser') {
      setStrokes((current) =>
        eraseMedicalImageStrokes(current, pending.point, pending.tolerance ?? 0.014),
      );
      return;
    }
    const strokeId = pending.strokeId;
    if (!strokeId) return;
    setStrokes((current) =>
      current.map((stroke) => {
        if (stroke.id !== strokeId || stroke.points.length >= 4096) return stroke;
        const previous = stroke.points.at(-1);
        if (
          previous &&
          (pending.point.x - previous.x) ** 2 + (pending.point.y - previous.y) ** 2 <
            MIN_POINT_DISTANCE ** 2
        ) {
          return stroke;
        }
        return { ...stroke, points: [...stroke.points, pending.point] };
      }),
    );
  };

  const schedulePoint = (pending: PendingAnnotationPoint): void => {
    pendingPoint = pending;
    if (annotationFrame !== undefined) return;
    annotationFrame = requestAnimationFrame(() => {
      annotationFrame = undefined;
      applyPendingPoint();
    });
  };

  const persist = (): void => {
    const sliceKey = props.sliceKey;
    if (!sliceKey) return;
    void putUserLibraryMedicalAnnotations(props.documentId, sliceKey, strokes()).catch(
      (cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Не удалось сохранить разметку.');
      },
    );
  };

  const handlePointerDown: JSX.EventHandlerUnion<SVGSVGElement, PointerEvent> = (event) => {
    if (props.disabled || props.tool === 'none' || !props.sliceKey) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerId = event.pointerId;
    annotationBounds = event.currentTarget.getBoundingClientRect();
    const point = pointFromEvent(event, annotationBounds);
    if (props.tool === 'eraser') {
      schedulePoint({
        point,
        mode: 'eraser',
        tolerance: 14 / Math.max(1, Math.min(annotationBounds.width, annotationBounds.height)),
      });
      return;
    }
    if (strokes().length >= 512) {
      setError('На этом срезе достигнут лимит разметки.');
      return;
    }
    activeStrokeId = crypto.randomUUID();
    setStrokes((current) => [
      ...current,
      { id: activeStrokeId as string, color: props.color, points: [point] },
    ]);
  };

  const handlePointerMove: JSX.EventHandlerUnion<SVGSVGElement, PointerEvent> = (event) => {
    if (event.pointerId !== activePointerId || props.tool === 'none') return;
    event.preventDefault();
    const bounds = annotationBounds ?? event.currentTarget.getBoundingClientRect();
    annotationBounds = bounds;
    const point = pointFromEvent(event, bounds);
    if (props.tool === 'eraser') {
      schedulePoint({
        point,
        mode: 'eraser',
        tolerance: 14 / Math.max(1, Math.min(bounds.width, bounds.height)),
      });
      return;
    }
    const strokeId = activeStrokeId;
    if (!strokeId) return;
    schedulePoint({ point, mode: 'pen', strokeId });
  };

  const finishPointer: JSX.EventHandlerUnion<SVGSVGElement, PointerEvent> = (event) => {
    if (event.pointerId !== activePointerId) return;
    if (annotationFrame !== undefined) {
      cancelAnimationFrame(annotationFrame);
      annotationFrame = undefined;
    }
    applyPendingPoint();
    activePointerId = undefined;
    activeStrokeId = undefined;
    annotationBounds = undefined;
    persist();
  };

  onCleanup(() => {
    if (annotationFrame !== undefined) cancelAnimationFrame(annotationFrame);
  });

  return (
    <>
      <svg
        class="medical-image-viewer__annotation-layer"
        classList={{
          'medical-image-viewer__annotation-layer--active':
            !props.disabled && props.tool !== 'none' && Boolean(props.sliceKey),
          'medical-image-viewer__annotation-layer--pen-red':
            props.tool === 'pen' && props.color === 'red',
          'medical-image-viewer__annotation-layer--pen-blue':
            props.tool === 'pen' && props.color === 'blue',
          'medical-image-viewer__annotation-layer--eraser': props.tool === 'eraser',
        }}
        viewBox={`0 0 ${String(VIEWBOX_SIZE)} ${String(VIEWBOX_SIZE)}`}
        preserveAspectRatio="none"
        aria-label="Разметка текущего среза"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      >
        <For each={strokes()}>
          {(stroke) => (
            <polyline
              class="medical-image-viewer__annotation-stroke"
              classList={{
                'medical-image-viewer__annotation-stroke--red': stroke.color === 'red',
                'medical-image-viewer__annotation-stroke--blue': stroke.color === 'blue',
              }}
              points={stroke.points
                .map(
                  (point) => `${String(point.x * VIEWBOX_SIZE)},${String(point.y * VIEWBOX_SIZE)}`,
                )
                .join(' ')}
            />
          )}
        </For>
      </svg>
      <Show when={error()}>
        {(message) => (
          <span class="medical-image-viewer__annotation-error" role="alert">
            {message()}
          </span>
        )}
      </Show>
    </>
  );
}
