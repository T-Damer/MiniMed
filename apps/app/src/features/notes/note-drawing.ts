import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFileData, BinaryFiles } from '@excalidraw/excalidraw/types';

import { isAppRoute } from '@/features/notes/note-link-targets';

export const NOTE_DRAWING_MIME = 'application/vnd.excalidraw+json';
export const NOTE_DRAWING_VERSION = 2 as const;

const MAX_DRAWING_BYTES = 64 * 1024 * 1024;
const MAX_ELEMENTS = 10_000;
const MAX_TEXT_LENGTH = 50_000;
const MAX_FILE_DATA_URL_LENGTH = 32 * 1024 * 1024;
const COLOR_PATTERN = /^(?:transparent|#[0-9a-f]{3,4}|#[0-9a-f]{6}(?:[0-9a-f]{2})?)$/iu;
const IMAGE_DATA_URL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/iu;
const WEB_LINK_PATTERN = /^https?:\/\/[^\s]+$/iu;
const MAX_LINK_LENGTH = 2048;

/** Native Excalidraw scene data kept as a note attachment. */
export interface DrawingDocument {
  readonly type: 'excalidraw';
  readonly version: typeof NOTE_DRAWING_VERSION;
  readonly source?: string;
  readonly elements: readonly ExcalidrawElement[];
  readonly appState?: Readonly<Partial<AppState>> | null;
  readonly files?: BinaryFiles;
}

export function createEmptyDrawing(): DrawingDocument {
  return {
    type: 'excalidraw',
    version: NOTE_DRAWING_VERSION,
    source: 'minimed',
    elements: [],
    appState: {
      viewBackgroundColor: '#fffdf8',
      exportBackground: true,
    },
    files: {},
  };
}

interface JsonRecord {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function safeColor(value: unknown): value is string {
  return typeof value === 'string' && COLOR_PATTERN.test(value);
}

function safePoint(value: unknown): value is readonly [number, number] {
  return (
    Array.isArray(value) && value.length === 2 && finiteNumber(value[0]) && finiteNumber(value[1])
  );
}

function safeElement(value: unknown): value is ExcalidrawElement {
  if (!isRecord(value)) return false;
  if (
    typeof value['id'] !== 'string' ||
    value['id'].length === 0 ||
    value['id'].length > 256 ||
    typeof value['type'] !== 'string' ||
    !finiteNumber(value['x']) ||
    !finiteNumber(value['y']) ||
    !finiteNumber(value['width']) ||
    !finiteNumber(value['height']) ||
    value['width'] < 0 ||
    value['height'] < 0 ||
    !finiteNumber(value['angle']) ||
    !finiteNumber(value['opacity']) ||
    value['opacity'] < 0 ||
    value['opacity'] > 100 ||
    !safeColor(value['strokeColor']) ||
    !safeColor(value['backgroundColor']) ||
    !finiteNumber(value['strokeWidth']) ||
    value['strokeWidth'] < 0 ||
    typeof value['isDeleted'] !== 'boolean' ||
    !isSafeDrawingLink(value['link'])
  ) {
    return false;
  }

  switch (value['type']) {
    case 'rectangle':
    case 'diamond':
    case 'ellipse':
    case 'frame':
    case 'magicframe':
      return true;
    case 'text':
      return typeof value['text'] === 'string' && value['text'].length <= MAX_TEXT_LENGTH;
    case 'line':
    case 'arrow':
    case 'freedraw':
      return (
        Array.isArray(value['points']) &&
        value['points'].length >= 2 &&
        value['points'].every(safePoint)
      );
    case 'image':
      return (
        (value['fileId'] === null || typeof value['fileId'] === 'string') &&
        (value['status'] === 'pending' ||
          value['status'] === 'saved' ||
          value['status'] === 'error')
      );
    case 'iframe':
    case 'embeddable':
    case 'selection':
    default:
      return false;
  }
}

/**
 * Element links may point inside MiniMed (`#/...`) or to an ordinary web page. Anything else,
 * including `javascript:` and `data:` URLs from an imported scene, rejects the whole drawing.
 */
export function isSafeDrawingLink(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'string' || value.length > MAX_LINK_LENGTH) return false;
  return isAppRoute(value) || WEB_LINK_PATTERN.test(value);
}

function safeBinaryFile(value: unknown): value is BinaryFileData {
  if (!isRecord(value)) return false;
  const mimeType = value['mimeType'];
  const dataURL = value['dataURL'];
  return (
    typeof mimeType === 'string' &&
    /^image\/[a-z0-9.+-]+$/iu.test(mimeType) &&
    typeof dataURL === 'string' &&
    dataURL.length <= MAX_FILE_DATA_URL_LENGTH &&
    IMAGE_DATA_URL_PATTERN.test(dataURL)
  );
}

function parseFiles(value: unknown): BinaryFiles | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const files: Record<string, BinaryFileData> = {};
  for (const [id, file] of Object.entries(value)) {
    if (id.length === 0 || id.length > 256 || !safeBinaryFile(file)) return null;
    files[id] = file;
  }
  return files;
}

export function parseDrawingValue(value: unknown): DrawingDocument | null {
  if (!isRecord(value)) return null;
  if (
    value['type'] !== 'excalidraw' ||
    value['version'] !== NOTE_DRAWING_VERSION ||
    !Array.isArray(value['elements']) ||
    value['elements'].length > MAX_ELEMENTS ||
    !value['elements'].every(safeElement)
  ) {
    return null;
  }

  const source = value['source'];
  if (source !== undefined && (typeof source !== 'string' || source.length > 512)) return null;

  const appState = value['appState'];
  if (appState !== undefined && appState !== null && !isRecord(appState)) return null;

  const files = parseFiles(value['files']);
  if (files === null) return null;

  return {
    type: 'excalidraw',
    version: NOTE_DRAWING_VERSION,
    ...(source === undefined ? {} : { source }),
    elements: value['elements'] as ExcalidrawElement[],
    ...(appState === undefined ? {} : { appState: appState as Readonly<Partial<AppState>> | null }),
    ...(files === undefined ? {} : { files }),
  };
}

export function parseDrawingDocument(value: string): DrawingDocument | null {
  if (value.length > MAX_DRAWING_BYTES) return null;
  try {
    return parseDrawingValue(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

export async function parseDrawingBlob(blob: Blob): Promise<DrawingDocument | null> {
  if (blob.size > MAX_DRAWING_BYTES) return null;
  try {
    return parseDrawingDocument(await blob.text());
  } catch {
    return null;
  }
}

export function serializeDrawingDocument(document: DrawingDocument): string {
  return JSON.stringify(document);
}

export function createDrawingFile(
  document: DrawingDocument,
  name = `Схема-${new Date().toISOString().slice(0, 10)}.excalidraw.json`,
): File {
  return new File([serializeDrawingDocument(document)], name, { type: NOTE_DRAWING_MIME });
}

export function isNoteDrawingMime(mimeType: string): boolean {
  return mimeType.toLowerCase() === NOTE_DRAWING_MIME;
}

export function isNoteDrawingFile(file: Pick<File, 'type' | 'name'>): boolean {
  const name = file.name.toLowerCase();
  return (
    isNoteDrawingMime(file.type) ||
    name.endsWith('.excalidraw.json') ||
    name.endsWith('.excalidraw')
  );
}

export interface DrawingLinkCard {
  readonly kindLabel: string;
  readonly title: string;
  readonly route: string;
}

export interface DrawingPoint {
  readonly x: number;
  readonly y: number;
}

const LINK_CARD_WIDTH = 280;
const LINK_CARD_HEIGHT = 96;
const LINK_CARD_TITLE_LENGTH = 90;

/** Scene coordinates of the centre of the visible canvas. */
export function drawingViewportCenter(
  appState: Pick<AppState, 'scrollX' | 'scrollY' | 'width' | 'height'> & {
    readonly zoom: { readonly value: number };
  },
): DrawingPoint {
  const zoom = appState.zoom.value > 0 ? appState.zoom.value : 1;
  return {
    x: appState.width / 2 / zoom - appState.scrollX,
    y: appState.height / 2 / zoom - appState.scrollY,
  };
}

/**
 * A labelled rectangle whose element link opens a MiniMed route. The label is plain text; the
 * route is the only navigation target, so the card survives catalog title changes.
 */
export function drawingLinkCardSkeleton(
  card: DrawingLinkCard,
  center: DrawingPoint,
  fontFamily?: number,
) {
  if (!isAppRoute(card.route)) throw new Error('A drawing card can only link inside MiniMed.');
  const title =
    card.title.length > LINK_CARD_TITLE_LENGTH
      ? `${card.title.slice(0, LINK_CARD_TITLE_LENGTH - 1)}…`
      : card.title;
  return {
    type: 'rectangle' as const,
    x: center.x - LINK_CARD_WIDTH / 2,
    y: center.y - LINK_CARD_HEIGHT / 2,
    width: LINK_CARD_WIDTH,
    height: LINK_CARD_HEIGHT,
    strokeColor: '#244b49',
    backgroundColor: '#e8f3f1',
    fillStyle: 'solid' as const,
    roughness: 0,
    roundness: { type: 3 as const },
    link: card.route,
    // The hand-drawn default font lacks full Cyrillic coverage; cards use a regular face.
    label: {
      text: `${card.kindLabel}\n${title}`,
      fontSize: 16,
      ...(fontFamily === undefined ? {} : { fontFamily }),
    },
  };
}
