import { For, type JSX } from 'solid-js';

/**
 * The quiet garden behind the doctor's sign-in: two vines grow out of opposite corners when the
 * page opens, their leaves unfold one by one and then sway, and a few loose leaves drift across.
 * Pure decoration (aria-hidden); colours come from the theme tokens, motion from CSS, so the
 * animation settings and reduced motion apply.
 */

type Tone = 'young' | 'deep' | 'warm';

interface Leaf {
  readonly x: number;
  readonly y: number;
  /** Angle of the leaf from its base, degrees. */
  readonly turn: number;
  readonly size: number;
  readonly tone: Tone;
}

/** The stem climbs from the bottom-left corner of a 220 × 320 box towards the top-right. */
const STEM = 'M8 318 C 30 262, 10 214, 50 170 C 90 126, 70 84, 110 46 C 138 20, 166 14, 198 6';

const LEAVES: readonly Leaf[] = [
  { x: 20, y: 280, turn: -38, size: 1, tone: 'young' },
  { x: 30, y: 240, turn: 200, size: 0.92, tone: 'deep' },
  { x: 38, y: 198, turn: -22, size: 1.12, tone: 'young' },
  { x: 64, y: 156, turn: 212, size: 0.96, tone: 'warm' },
  { x: 80, y: 118, turn: -42, size: 1, tone: 'deep' },
  { x: 96, y: 74, turn: 196, size: 0.9, tone: 'young' },
  { x: 118, y: 40, turn: -16, size: 0.86, tone: 'deep' },
  { x: 150, y: 20, turn: 190, size: 0.78, tone: 'young' },
  { x: 178, y: 11, turn: -26, size: 0.66, tone: 'warm' },
];

/** An almond leaf with its base at (0, 0), pointing right, with a midrib. */
const LEAF_BLADE = 'M0 0 C 6 -9, 22 -12, 34 -2 C 24 8, 8 9, 0 0 Z';
const LEAF_RIB = 'M3 -0.5 C 12 -2, 20 -2.5, 29 -2.5';

function Vine(props: { readonly corner: 'start' | 'end' }): JSX.Element {
  return (
    <svg
      class={`diary-garden__vine diary-garden__vine--${props.corner}`}
      viewBox="0 0 220 320"
      aria-hidden="true"
    >
      <path class="diary-garden__stem" d={STEM} pathLength="1" />
      <For each={LEAVES}>
        {(leaf, index) => (
          <g transform={`translate(${leaf.x} ${leaf.y}) rotate(${leaf.turn}) scale(${leaf.size})`}>
            <g class="diary-garden__leaf" style={{ '--leaf-index': String(index()) }}>
              <path
                class={`diary-garden__blade diary-garden__blade--${leaf.tone}`}
                d={LEAF_BLADE}
              />
              <path class="diary-garden__rib" d={LEAF_RIB} />
            </g>
          </g>
        )}
      </For>
    </svg>
  );
}

const DRIFTERS: readonly { readonly lane: string; readonly tone: Tone }[] = [
  { lane: '1', tone: 'young' },
  { lane: '2', tone: 'warm' },
  { lane: '3', tone: 'deep' },
  { lane: '4', tone: 'young' },
  { lane: '5', tone: 'deep' },
];

export function SignInGarden(): JSX.Element {
  return (
    <div class="diary-garden" aria-hidden="true">
      <Vine corner="start" />
      <Vine corner="end" />
      <For each={DRIFTERS}>
        {(drifter) => (
          <svg
            class={`diary-garden__drift diary-garden__drift--lane-${drifter.lane}`}
            viewBox="-2 -14 40 28"
            aria-hidden="true"
          >
            <path
              class={`diary-garden__blade diary-garden__blade--${drifter.tone}`}
              d={LEAF_BLADE}
            />
            <path class="diary-garden__rib" d={LEAF_RIB} />
          </svg>
        )}
      </For>
    </div>
  );
}
