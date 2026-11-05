import { createUniqueId, type JSX, Match, Switch } from 'solid-js';

import { type DrugShape, drugShape, pillHue, pillLetter } from '@/components/pill-mark';

import '@/components/PillMark.css';

/** Each shape's outline in a 24×24 box, and where its letter sits. */
const SHAPES: Readonly<
  Record<
    DrugShape,
    {
      readonly path: string;
      readonly x: number;
      readonly y: number;
      readonly size: number;
      readonly transform?: string;
    }
  >
> = {
  tablet: {
    path: 'M12 1.4a10.6 10.6 0 1 1 0 21.2a10.6 10.6 0 1 1 0-21.2z',
    x: 12,
    y: 12.6,
    size: 11,
  },
  capsule: {
    path: 'M6.6 7.4h10.8a4.6 4.6 0 0 1 0 9.2H6.6a4.6 4.6 0 0 1 0-9.2z',
    transform: 'rotate(-40 12 12)',
    x: 12,
    y: 12.6,
    size: 10,
  },
  liquid: {
    path: 'M9 1.8h6v3.4h-0.6v1.6c2.6 0.6 4.4 2.6 4.4 5.2v8.4a2.4 2.4 0 0 1-2.4 2.4H7.6a2.4 2.4 0 0 1-2.4-2.4V12c0-2.6 1.8-4.6 4.4-5.2V5.2H9z',
    x: 12,
    y: 15.6,
    size: 10,
  },
  ampoule: {
    path: 'M12 1.4c0.9 1.6 1.4 3 1.4 4.2c0 0.8-0.4 1.4-0.4 2.2c1.6 0.9 3 2.4 3 4.4v8.2a2.2 2.2 0 0 1-2.2 2.2h-3.6a2.2 2.2 0 0 1-2.2-2.2v-8.2c0-2 1.4-3.5 3-4.4c0-0.8-0.4-1.4-0.4-2.2c0-1.2 0.5-2.6 1.4-4.2z',
    x: 12,
    y: 16,
    size: 9,
  },
  tube: {
    path: 'M8.6 1.6h6.8v2.6h-0.8v1.2l3.6 2.4v12.6a2.2 2.2 0 0 1-2.2 2.2H7.999a2.2 2.2 0 0 1-2.2-2.2V7.8l3.6-2.4V4.2h-0.8z',
    x: 12,
    y: 15,
    size: 9.5,
  },
};

/**
 * A medicine's mark (owner 2026-11-04): the first letter of its name on its form — a pressed tablet,
 * a capsule, a bottle of solution, an ampoule or a tube — tinted by the name, lit from the top left,
 * with a fine grain and a soft shadow. Decorative: the row says the name in words.
 */
export function PillMark(props: {
  readonly name: string;
  /** The medicine's form as the plan writes it («таблетки», «раствор для инъекций»). */
  readonly form?: string | undefined;
  readonly class?: string;
}): JSX.Element {
  const id = createUniqueId();
  const shape = () => drugShape(props.form);
  const geometry = () => SHAPES[shape()];
  return (
    <svg
      class={`pill-mark pill-mark--${shape()}${props.class ? ` ${props.class}` : ''}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ '--pill-hue': String(pillHue(props.name)) }}
    >
      <defs>
        <radialGradient id={`pill-face-${id}`} cx="0.36" cy="0.3" r="0.78">
          <stop class="pill-mark__stop-light" offset="0" />
          <stop class="pill-mark__stop-mid" offset="0.62" />
          <stop class="pill-mark__stop-dark" offset="1" />
        </radialGradient>
        <filter id={`pill-grain-${id}`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="3.2" numOctaves="1" seed="7" />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.3 -0.12" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <clipPath id={`pill-clip-${id}`}>
          <path d={geometry().path} />
        </clipPath>
      </defs>
      <path
        class="pill-mark__body"
        d={geometry().path}
        transform={geometry().transform}
        fill={`url(#pill-face-${id})`}
      />
      <Switch>
        <Match when={shape() === 'tablet'}>
          <circle class="pill-mark__bevel" cx="12" cy="12" r="8.6" />
        </Match>
        <Match when={shape() === 'capsule'}>
          {/* The other half of the shell: lighter, across the seam. */}
          <rect
            class="pill-mark__half"
            clip-path={`url(#pill-clip-${id})`}
            transform={geometry().transform}
            x="12"
            y="0"
            width="12"
            height="24"
          />
        </Match>
        <Match when={shape() === 'liquid' || shape() === 'ampoule'}>
          {/* The liquid inside: the lower part of the glass, tinted deeper. */}
          <rect
            class="pill-mark__liquid"
            clip-path={`url(#pill-clip-${id})`}
            x="0"
            y={shape() === 'liquid' ? 11 : 12}
            width="24"
            height="13"
          />
        </Match>
      </Switch>
      <path
        class="pill-mark__grain"
        d={geometry().path}
        transform={geometry().transform}
        filter={`url(#pill-grain-${id})`}
      />
      <text
        class="pill-mark__letter-light"
        x={geometry().x}
        y={geometry().y + 0.65}
        font-size={String(geometry().size)}
        text-anchor="middle"
        dominant-baseline="middle"
      >
        {pillLetter(props.name)}
      </text>
      <text
        class="pill-mark__letter"
        x={geometry().x}
        y={geometry().y}
        font-size={String(geometry().size)}
        text-anchor="middle"
        dominant-baseline="middle"
      >
        {pillLetter(props.name)}
      </text>
    </svg>
  );
}
