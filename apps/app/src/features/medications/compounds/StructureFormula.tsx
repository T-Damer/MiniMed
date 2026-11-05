import { createEffect, createSignal, type JSX, onCleanup, Show } from 'solid-js';

import '@/features/medications/compounds/structure-formula.css';

/** Atom colours readable on paper and on the dark theme; carbon and bonds take the text colour. */
const STRUCTURE_THEME = {
  FOREGROUND: 'currentColor',
  BACKGROUND: 'transparent',
  C: 'currentColor',
  H: 'currentColor',
  O: '#d0453a',
  N: '#3f7fd0',
  F: '#3c9f6b',
  CL: '#3c9f6b',
  BR: '#a8552d',
  I: '#8a4fbf',
  P: '#d4831f',
  S: '#c9a227',
  B: '#c47a4a',
  SI: '#c47a4a',
} as const;

/**
 * A compound's 2D structure drawn from its SMILES (smiles-drawer, MIT; loaded only when a structure
 * is shown). Nothing is drawn when the SMILES does not parse: no broken picture, no message.
 */
export function StructureFormula(props: {
  readonly smiles: string;
  readonly label: string;
  readonly size?: 'thumb' | 'large';
  readonly class?: string;
}): JSX.Element {
  const [failed, setFailed] = createSignal(false);
  let svg: SVGSVGElement | undefined;

  createEffect(() => {
    const smiles = props.smiles;
    const target = svg;
    if (!target) return;
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    setFailed(false);
    const large = props.size === 'large';
    import('smiles-drawer').then(
      ({ default: SmilesDrawer }) => {
        if (cancelled) return;
        // Drawn at one size and scaled by CSS (viewBox): a thumbnail drawn small came out as faint
        // hairlines. A thumbnail only needs heavier bonds.
        const drawer = new SmilesDrawer.SvgDrawer({
          width: 320,
          height: 240,
          bondThickness: large ? 1.4 : 3,
          fontSizeLarge: large ? 10 : 14,
          fontSizeSmall: large ? 7 : 10,
          padding: large ? 16 : 10,
          themes: { minimed: STRUCTURE_THEME },
        });
        SmilesDrawer.parse(
          smiles,
          (tree) => {
            if (cancelled) return;
            target.replaceChildren();
            drawer.draw(tree, target, 'minimed');
          },
          () => {
            if (!cancelled) setFailed(true);
          },
        );
      },
      (error: unknown) => {
        console.error('Structure drawing library failed to load', error);
        if (!cancelled) setFailed(true);
      },
    );
  });

  return (
    <Show when={!failed()}>
      <svg
        ref={svg}
        class={`structure-formula structure-formula--${props.size ?? 'thumb'}${props.class ? ` ${props.class}` : ''}`}
        role="img"
        aria-label={props.label}
        data-smiles={props.smiles}
      />
    </Show>
  );
}
