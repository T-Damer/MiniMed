import { type Accessor, createSignal } from 'solid-js';
import type { EcgNormalizedPoint, EcgNormalizedRegion } from './ecg-model-contract';

const FULL_VIEW: EcgNormalizedRegion = { x: 0, y: 0, width: 1, height: 1 };
export function clampEcgView(view: EcgNormalizedRegion): EcgNormalizedRegion {
  const width = Math.min(1, Math.max(1 / 20, view.width));
  const height = Math.min(1, Math.max(1 / 20, view.height));
  return {
    width,
    height,
    x: Math.max(0, Math.min(1 - width, view.x)),
    y: Math.max(0, Math.min(1 - height, view.y)),
  };
}

/** SVG viewport interaction only. Clinical annotations own separate pointer gestures. */
export function useEcgViewport(size: Accessor<{ width: number; height: number }>) {
  const [view, setView] = createSignal<EcgNormalizedRegion>(FULL_VIEW);
  let svg: SVGSVGElement | undefined;
  const pointers = new Map<number, EcgNormalizedPoint>();
  let gesture:
    | { view: EcgNormalizedRegion; center: EcgNormalizedPoint; distance: number; matrix: DOMMatrix }
    | undefined;
  const center = (): EcgNormalizedPoint => {
    const points = [...pointers.values()];
    return {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    };
  };
  const distance = (): number => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const startGesture = (): void => {
    const matrix = svg?.getScreenCTM();
    if (!matrix || !pointers.size) {
      gesture = undefined;
      return;
    }
    gesture = { view: view(), center: center(), distance: distance(), matrix };
  };
  const point = (clientX: number, clientY: number): EcgNormalizedPoint => {
    const matrix = svg?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const local = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: local.x / size().width, y: local.y / size().height };
  };
  const zoom = (factor: number, anchor?: EcgNormalizedPoint): void => {
    const old = view();
    const at = anchor ?? { x: old.x + old.width / 2, y: old.y + old.height / 2 };
    const width = Math.min(1, Math.max(0.05, old.width / factor));
    const height = Math.min(1, Math.max(0.05, old.height / factor));
    setView(
      clampEcgView({
        x: at.x - ((at.x - old.x) * width) / old.width,
        y: at.y - ((at.y - old.y) * height) / old.height,
        width,
        height,
      }),
    );
  };
  const down = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    svg?.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    startGesture();
  };
  const move = (event: PointerEvent): void => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    event.preventDefault();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = center();
    const ratio = gesture.distance > 0 ? distance() / gesture.distance : 1;
    const width = Math.min(1, Math.max(0.05, gesture.view.width / Math.max(0.1, ratio)));
    const height = Math.min(1, Math.max(0.05, gesture.view.height / Math.max(0.1, ratio)));
    const anchor = new DOMPoint(gesture.center.x, gesture.center.y).matrixTransform(
      gesture.matrix.inverse(),
    );
    const ax = anchor.x / size().width;
    const ay = anchor.y / size().height;
    setView(
      clampEcgView({
        x:
          ax -
          ((ax - gesture.view.x) * width) / gesture.view.width -
          (((current.x - gesture.center.x) / gesture.matrix.a / size().width) * width) /
            gesture.view.width,
        y:
          ay -
          ((ay - gesture.view.y) * height) / gesture.view.height -
          (((current.y - gesture.center.y) / gesture.matrix.d / size().height) * height) /
            gesture.view.height,
        width,
        height,
      }),
    );
  };
  const up = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    if (svg?.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    startGesture();
  };
  return {
    ref: (element: SVGSVGElement) => {
      svg = element;
    },
    point,
    view,
    viewBox: () =>
      `${view().x * size().width} ${view().y * size().height} ${view().width * size().width} ${view().height * size().height}`,
    reset: () => setView(FULL_VIEW),
    focus: (region: EcgNormalizedRegion) =>
      setView(
        clampEcgView({
          x: region.x - 0.015,
          y: region.y - 0.015,
          width: region.width + 0.03,
          height: region.height + 0.03,
        }),
      ),
    zoom,
    down,
    move,
    up,
    wheel: (event: WheelEvent) => {
      event.preventDefault();
      zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15, point(event.clientX, event.clientY));
    },
  };
}
