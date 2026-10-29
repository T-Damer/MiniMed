import { createMemo, createUniqueId, For, type JSX } from 'solid-js';

import { type ArtShape, type LesionArt, lesionArtShapes } from '@/features/skin/skin-lesion-art';

const shapesCache = new WeakMap<LesionArt, readonly ArtShape[]>();

function shapesOf(art: LesionArt): readonly ArtShape[] {
  const cached = shapesCache.get(art);
  if (cached) return cached;
  const shapes = lesionArtShapes(art);
  shapesCache.set(art, shapes);
  return shapes;
}

/** One drawn reference picture of the atlas (a schema, not a photo). */
export function SkinLesionArt(props: {
  readonly art: LesionArt;
  readonly class?: string;
  /** Spoken name; the picture is decorative when the caption is visible beside it. */
  readonly label?: string;
}): JSX.Element {
  const id = createUniqueId();
  const shapes = createMemo(() => shapesOf(props.art));
  const filterUrl = (filter: ArtShape['filter']): string | undefined =>
    filter ? `url(#${id}-${filter})` : undefined;
  return (
    <svg
      class={props.class}
      viewBox="0 0 100 100"
      role={props.label ? 'img' : undefined}
      aria-hidden={props.label ? undefined : 'true'}
      preserveAspectRatio="xMidYMid slice"
    >
      <title>{props.label ?? props.art.caption}</title>
      <defs>
        <filter id={`${id}-soft`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="0.8" />
        </filter>
        <filter id={`${id}-blur`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>
      <For each={shapes()}>
        {(shape) =>
          shape.kind === 'circle' ? (
            <circle
              cx={shape.cx}
              cy={shape.cy}
              r={shape.r}
              fill={shape.fill}
              opacity={shape.opacity}
              stroke={shape.stroke}
              stroke-width={shape.strokeWidth}
              filter={filterUrl(shape.filter)}
            />
          ) : (
            <path
              d={shape.d}
              fill={shape.fill}
              opacity={shape.opacity}
              stroke={shape.stroke}
              stroke-width={shape.strokeWidth}
              stroke-linecap="round"
              filter={filterUrl(shape.filter)}
            />
          )
        }
      </For>
    </svg>
  );
}
