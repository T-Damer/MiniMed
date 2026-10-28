import appWindowBold from '@phosphor-icons/core/assets/bold/app-window-bold.svg?raw';
import arrowClockwiseBold from '@phosphor-icons/core/assets/bold/arrow-clockwise-bold.svg?raw';
import checkCircleBold from '@phosphor-icons/core/assets/bold/check-circle-bold.svg?raw';
import exportBold from '@phosphor-icons/core/assets/bold/export-bold.svg?raw';
import lockSimpleBold from '@phosphor-icons/core/assets/bold/lock-simple-bold.svg?raw';
import plusSquareBold from '@phosphor-icons/core/assets/bold/plus-square-bold.svg?raw';
import starBold from '@phosphor-icons/core/assets/bold/star-bold.svg?raw';
import warningBold from '@phosphor-icons/core/assets/bold/warning-bold.svg?raw';
import type { JSX } from 'solid-js';

/**
 * Icons only the install warning and guide need (the shared glyph set has no warning triangle or
 * iOS share square). Same Phosphor bold set and rendering as `AppGlyph`.
 */
const BODIES = {
  'app-window': appWindowBold,
  reload: arrowClockwiseBold,
  'check-circle': checkCircleBold,
  share: exportBold,
  lock: lockSimpleBold,
  'plus-square': plusSquareBold,
  star: starBold,
  warning: warningBold,
} as const;

export type InstallGlyphName = keyof typeof BODIES;

function svgBody(asset: string): string {
  return asset.slice(asset.indexOf('>') + 1, asset.lastIndexOf('</svg>'));
}

export function InstallGlyph(props: {
  readonly name: InstallGlyphName;
  readonly class?: string;
}): JSX.Element {
  return (
    <svg
      class={props.class}
      viewBox="0 0 256 256"
      aria-hidden="true"
      fill="currentColor"
      innerHTML={svgBody(BODIES[props.name])}
    />
  );
}
