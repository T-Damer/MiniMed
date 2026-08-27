import { createEffect, createSignal, For, type JSX, Show } from 'solid-js';

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

export function MedicalImageAnnotationToolbar(props: {
  readonly tool: MedicalImageAnnotationTool;
  readonly color: UserLibraryMedicalAnnotationColor;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
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
        aria-label="Красный карандаш"
        title="Красный карандаш"
        aria-pressed={props.tool === 'pen' && props.color === 'red'}
        disabled={props.disabled}
        onClick={() => selectColor('red')}
      />
      <button
        class="medical-image-viewer__annotation-color medical-image-viewer__annotation-color--blue"
        classList={{
          'medical-image-viewer__annotation-color--active':
            props.tool === 'pen' && props.color === 'blue',
        }}
        type="button"
        aria-label="Синий карандаш"
        title="Синий карандаш"
        aria-pressed={props.tool === 'pen' && props.color === 'blue'}
        disabled={props.disabled}
        onClick={() => selectColor('blue')}
      />
      <Button
        class="medical-image-viewer__tool medical-image-viewer__tool--icon"
        variant={props.tool === 'eraser' ? 'primary' : 'icon'}
        aria-label="Ластик"
        title={props.disabled ? props.disabledReason : 'Ластик'}
        aria-pressed={props.tool === 'eraser'}
        disabled={props.disabled}
        onClick={() => props.onToolChange(props.tool === 'eraser' ? 'none' : 'eraser')}
        icon={<AppGlyph name="eraser" class="medical-image-viewer__tool-icon" />}
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
  let loadGeneration = 0;

  createEffect(() => {
    const sliceKey = props.sliceKey;
    const generation = ++loadGeneration;
    activePointerId = undefined;
    activeStrokeId = undefined;
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
  ): UserLibraryMedicalAnnotationPoint => {
    // ponytail: Screen-space vectors follow viewport resizing; use viewer world coordinates if marks must follow zoom/pan.
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width))),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / Math.max(1, bounds.height))),
    };
  };

  const eraseAt = (
    event: PointerEvent & { readonly currentTarget: SVGSVGElement },
    point: UserLibraryMedicalAnnotationPoint,
  ): void => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const tolerance = 14 / Math.max(1, Math.min(bounds.width, bounds.height));
    setStrokes((current) => eraseMedicalImageStrokes(current, point, tolerance));
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
    const point = pointFromEvent(event);
    if (props.tool === 'eraser') {
      eraseAt(event, point);
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
    const point = pointFromEvent(event);
    if (props.tool === 'eraser') {
      eraseAt(event, point);
      return;
    }
    const strokeId = activeStrokeId;
    if (!strokeId) return;
    setStrokes((current) =>
      current.map((stroke) => {
        if (stroke.id !== strokeId || stroke.points.length >= 4096) return stroke;
        const previous = stroke.points.at(-1);
        if (
          previous &&
          (point.x - previous.x) ** 2 + (point.y - previous.y) ** 2 < MIN_POINT_DISTANCE ** 2
        ) {
          return stroke;
        }
        return { ...stroke, points: [...stroke.points, point] };
      }),
    );
  };

  const finishPointer: JSX.EventHandlerUnion<SVGSVGElement, PointerEvent> = (event) => {
    if (event.pointerId !== activePointerId) return;
    activePointerId = undefined;
    activeStrokeId = undefined;
    persist();
  };

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
