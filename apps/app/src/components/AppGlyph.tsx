import archiveBold from '@phosphor-icons/core/assets/bold/archive-bold.svg?raw';
import arrowLeftBold from '@phosphor-icons/core/assets/bold/arrow-left-bold.svg?raw';
import arrowSquareUpRightBold from '@phosphor-icons/core/assets/bold/arrow-square-up-right-bold.svg?raw';
import arrowUUpLeftBold from '@phosphor-icons/core/assets/bold/arrow-u-up-left-bold.svg?raw';
import arrowUpBold from '@phosphor-icons/core/assets/bold/arrow-up-bold.svg?raw';
import arrowUpRightBold from '@phosphor-icons/core/assets/bold/arrow-up-right-bold.svg?raw';
import arrowsClockwiseBold from '@phosphor-icons/core/assets/bold/arrows-clockwise-bold.svg?raw';
import arrowsOutBold from '@phosphor-icons/core/assets/bold/arrows-out-bold.svg?raw';
import binocularsBold from '@phosphor-icons/core/assets/bold/binoculars-bold.svg?raw';
import bookOpenBold from '@phosphor-icons/core/assets/bold/book-open-bold.svg?raw';
import brainBold from '@phosphor-icons/core/assets/bold/brain-bold.svg?raw';
import calculatorBold from '@phosphor-icons/core/assets/bold/calculator-bold.svg?raw';
import caretDownBold from '@phosphor-icons/core/assets/bold/caret-down-bold.svg?raw';
import caretUpBold from '@phosphor-icons/core/assets/bold/caret-up-bold.svg?raw';
import checkBold from '@phosphor-icons/core/assets/bold/check-bold.svg?raw';
import clockCounterClockwiseBold from '@phosphor-icons/core/assets/bold/clock-counter-clockwise-bold.svg?raw';
import downloadSimpleBold from '@phosphor-icons/core/assets/bold/download-simple-bold.svg?raw';
import fileTextBold from '@phosphor-icons/core/assets/bold/file-text-bold.svg?raw';
import folderOpenBold from '@phosphor-icons/core/assets/bold/folder-open-bold.svg?raw';
import gearSixBold from '@phosphor-icons/core/assets/bold/gear-six-bold.svg?raw';
import graphBold from '@phosphor-icons/core/assets/bold/graph-bold.svg?raw';
import houseBold from '@phosphor-icons/core/assets/bold/house-bold.svg?raw';
import listBold from '@phosphor-icons/core/assets/bold/list-bold.svg?raw';
import listChecksBold from '@phosphor-icons/core/assets/bold/list-checks-bold.svg?raw';
import magnifyingGlassBold from '@phosphor-icons/core/assets/bold/magnifying-glass-bold.svg?raw';
import minusBold from '@phosphor-icons/core/assets/bold/minus-bold.svg?raw';
import noteBold from '@phosphor-icons/core/assets/bold/note-bold.svg?raw';
import notepadBold from '@phosphor-icons/core/assets/bold/notepad-bold.svg?raw';
import pencilSimpleBold from '@phosphor-icons/core/assets/bold/pencil-simple-bold.svg?raw';
import pillBold from '@phosphor-icons/core/assets/bold/pill-bold.svg?raw';
import printerBold from '@phosphor-icons/core/assets/bold/printer-bold.svg?raw';
import questionMarkBold from '@phosphor-icons/core/assets/bold/question-mark-bold.svg?raw';
import shareFatBold from '@phosphor-icons/core/assets/bold/share-fat-bold.svg?raw';
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
  | 'notepad'
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
  | 'caret-down'
  | 'caret-up'
  | 'refresh'
  | 'download'
  | 'folder-open'
  | 'minus'
  | 'arrow-up-right'
  | 'arrows-out'
  | 'check'
  | 'edit'
  | 'trash'
  | 'printer'
  | 'question'
  | 'share'
  | 'share-fat'
  | 'binoculars'
  | 'arrow-square-up-right'
  | 'house'
  | 'arrow-u-up-left'
  | 'file-text'
  | 'pill';

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
  notepad: svgBody(notepadBold),
  brain: svgBody(brainBold),
  'list-checks': svgBody(listChecksBold),
  system: svgBody(gearSixBold),
  close: svgBody(xBold),
  graph: svgBody(graphBold),
  calculator: svgBody(calculatorBold),
  list: svgBody(listBold),
  'arrow-left': svgBody(arrowLeftBold),
  'arrow-up': svgBody(arrowUpBold),
  'book-open': svgBody(bookOpenBold),
  'caret-down': svgBody(caretDownBold),
  'caret-up': svgBody(caretUpBold),
  refresh: svgBody(arrowsClockwiseBold),
  download: svgBody(downloadSimpleBold),
  'folder-open': svgBody(folderOpenBold),
  minus: svgBody(minusBold),
  'arrow-up-right': svgBody(arrowUpRightBold),
  'arrows-out': svgBody(arrowsOutBold),
  check: svgBody(checkBold),
  edit: svgBody(pencilSimpleBold),
  trash: svgBody(trashBold),
  printer: svgBody(printerBold),
  question: svgBody(questionMarkBold),
  share: svgBody(shareNetworkBold),
  'share-fat': svgBody(shareFatBold),
  binoculars: svgBody(binocularsBold),
  'arrow-square-up-right': svgBody(arrowSquareUpRightBold),
  house: svgBody(houseBold),
  'arrow-u-up-left': svgBody(arrowUUpLeftBold),
  'file-text': svgBody(fileTextBold),
  pill: svgBody(pillBold),
};

export function AppGlyph(props: {
  readonly name: AppGlyphName;
  readonly class?: string;
}): JSX.Element {
  return (
    <svg
      class={`app-glyph${props.class ? ` ${props.class}` : ''}`}
      viewBox="0 0 256 256"
      aria-hidden="true"
      fill="currentColor"
      innerHTML={glyphBodies[props.name]}
    />
  );
}
