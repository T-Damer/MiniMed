import archiveBold from '@phosphor-icons/core/assets/bold/archive-bold.svg?raw';
import arrowLeftBold from '@phosphor-icons/core/assets/bold/arrow-left-bold.svg?raw';
import arrowSquareUpRightBold from '@phosphor-icons/core/assets/bold/arrow-square-up-right-bold.svg?raw';
import arrowUpBold from '@phosphor-icons/core/assets/bold/arrow-up-bold.svg?raw';
import arrowUpRightBold from '@phosphor-icons/core/assets/bold/arrow-up-right-bold.svg?raw';
import arrowsClockwiseBold from '@phosphor-icons/core/assets/bold/arrows-clockwise-bold.svg?raw';
import binocularsBold from '@phosphor-icons/core/assets/bold/binoculars-bold.svg?raw';
import bookOpenBold from '@phosphor-icons/core/assets/bold/book-open-bold.svg?raw';
import brainBold from '@phosphor-icons/core/assets/bold/brain-bold.svg?raw';
import calculatorBold from '@phosphor-icons/core/assets/bold/calculator-bold.svg?raw';
import clockCounterClockwiseBold from '@phosphor-icons/core/assets/bold/clock-counter-clockwise-bold.svg?raw';
import downloadSimpleBold from '@phosphor-icons/core/assets/bold/download-simple-bold.svg?raw';
import gearBold from '@phosphor-icons/core/assets/bold/gear-bold.svg?raw';
import graphBold from '@phosphor-icons/core/assets/bold/graph-bold.svg?raw';
import listBold from '@phosphor-icons/core/assets/bold/list-bold.svg?raw';
import listChecksBold from '@phosphor-icons/core/assets/bold/list-checks-bold.svg?raw';
import magnifyingGlassBold from '@phosphor-icons/core/assets/bold/magnifying-glass-bold.svg?raw';
import minusBold from '@phosphor-icons/core/assets/bold/minus-bold.svg?raw';
import noteBold from '@phosphor-icons/core/assets/bold/note-bold.svg?raw';
import pencilSimpleBold from '@phosphor-icons/core/assets/bold/pencil-simple-bold.svg?raw';
import printerBold from '@phosphor-icons/core/assets/bold/printer-bold.svg?raw';
import shareNetworkBold from '@phosphor-icons/core/assets/bold/share-network-bold.svg?raw';
import stackBold from '@phosphor-icons/core/assets/bold/stack-bold.svg?raw';
import trashBold from '@phosphor-icons/core/assets/bold/trash-bold.svg?raw';
import xBold from '@phosphor-icons/core/assets/bold/x-bold.svg?raw';
import type { JSX } from 'solid-js';

export type AppGlyphName =
  | 'search'
  | 'archive'
  | 'modules'
  | 'history'
  | 'menu'
  | 'notes'
  | 'brain'
  | 'list-checks'
  | 'system'
  | 'close'
  | 'graph'
  | 'calculator'
  | 'list'
  | 'arrow-left'
  | 'arrow-up'
  | 'book-open'
  | 'refresh'
  | 'download'
  | 'minus'
  | 'arrow-up-right'
  | 'edit'
  | 'trash'
  | 'printer'
  | 'share'
  | 'binoculars'
  | 'arrow-square-up-right';

function svgBody(asset: string): string {
  return asset.slice(asset.indexOf('>') + 1, asset.lastIndexOf('</svg>'));
}

const glyphBodies: Record<AppGlyphName, string> = {
  search: svgBody(magnifyingGlassBold),
  archive: svgBody(archiveBold),
  modules: svgBody(stackBold),
  history: svgBody(clockCounterClockwiseBold),
  menu: svgBody(listBold),
  notes: svgBody(noteBold),
  brain: svgBody(brainBold),
  'list-checks': svgBody(listChecksBold),
  system: svgBody(gearBold),
  close: svgBody(xBold),
  graph: svgBody(graphBold),
  calculator: svgBody(calculatorBold),
  list: svgBody(listBold),
  'arrow-left': svgBody(arrowLeftBold),
  'arrow-up': svgBody(arrowUpBold),
  'book-open': svgBody(bookOpenBold),
  refresh: svgBody(arrowsClockwiseBold),
  download: svgBody(downloadSimpleBold),
  minus: svgBody(minusBold),
  'arrow-up-right': svgBody(arrowUpRightBold),
  edit: svgBody(pencilSimpleBold),
  trash: svgBody(trashBold),
  printer: svgBody(printerBold),
  share: svgBody(shareNetworkBold),
  binoculars: svgBody(binocularsBold),
  'arrow-square-up-right': svgBody(arrowSquareUpRightBold),
};

export function AppGlyph(props: {
  readonly name: AppGlyphName;
  readonly class?: string;
}): JSX.Element {
  return (
    <svg
      class={props.class}
      viewBox="0 0 256 256"
      aria-hidden="true"
      fill="currentColor"
      innerHTML={glyphBodies[props.name]}
    />
  );
}
