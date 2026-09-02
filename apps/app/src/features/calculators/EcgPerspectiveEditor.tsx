import { For, type JSX } from 'solid-js';

import type {
  EcgNormalizedPoint,
  EcgPhotoCorners,
} from '@/features/calculators/ecg-model-contract';

type CornerName = keyof EcgPhotoCorners;

const CORNERS: readonly { readonly id: CornerName; readonly label: string }[] = [
  { id: 'topLeft', label: 'Верхний левый угол листа' },
  { id: 'topRight', label: 'Верхний правый угол листа' },
  { id: 'bottomRight', label: 'Нижний правый угол листа' },
  { id: 'bottomLeft', label: 'Нижний левый угол листа' },
];

interface EcgPerspectiveEditorProps {
  readonly corners: EcgPhotoCorners;
  readonly onChange: (corners: EcgPhotoCorners) => void;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function EcgPerspectiveEditor(props: EcgPerspectiveEditorProps): JSX.Element {
  let overlay: HTMLDivElement | undefined;

  const setCorner = (name: CornerName, point: EcgNormalizedPoint): void => {
    props.onChange({ ...props.corners, [name]: point });
  };

  const moveCorner = (name: CornerName, event: PointerEvent): void => {
    const bounds = overlay?.getBoundingClientRect();
    if (!bounds) return;
    setCorner(name, {
      x: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width)),
      y: clamp((event.clientY - bounds.top) / Math.max(1, bounds.height)),
    });
  };

  const polygonPoints = (): string =>
    CORNERS.map(({ id }) => `${props.corners[id].x * 100},${props.corners[id].y * 100}`).join(' ');

  return (
    <div ref={overlay} class="ecg-perspective">
      <svg
        class="ecg-perspective__outline"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polygon class="ecg-perspective__polygon" points={polygonPoints()} />
      </svg>
      <For each={CORNERS}>
        {(corner) => (
          <button
            class="ecg-perspective__handle"
            type="button"
            aria-label={corner.label}
            style={{
              left: `${props.corners[corner.id].x * 100}%`,
              top: `${props.corners[corner.id].y * 100}%`,
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              moveCorner(corner.id, event);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              event.preventDefault();
              event.stopPropagation();
              moveCorner(corner.id, event);
            }}
            onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
            onKeyDown={(event) => {
              const directions: Partial<Record<string, EcgNormalizedPoint>> = {
                ArrowDown: { x: 0, y: 1 },
                ArrowLeft: { x: -1, y: 0 },
                ArrowRight: { x: 1, y: 0 },
                ArrowUp: { x: 0, y: -1 },
              };
              const direction = directions[event.key];
              if (!direction) return;
              event.preventDefault();
              const step = event.shiftKey ? 0.02 : 0.005;
              const current = props.corners[corner.id];
              setCorner(corner.id, {
                x: clamp(current.x + direction.x * step),
                y: clamp(current.y + direction.y * step),
              });
            }}
          />
        )}
      </For>
    </div>
  );
}
