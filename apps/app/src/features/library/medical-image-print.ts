export const MEDICAL_IMAGE_PRINT_MAX_IMAGES_PER_PAGE = 16;
export const MEDICAL_IMAGE_PRINT_GRID_MAX_IMAGES_PER_PAGE = 4;

export type MedicalImagePrintLayout = number;
export type MedicalImagePrintDirectionId = 'series' | 'axial' | 'coronal' | 'sagittal' | 'grid';
export type MedicalImagePrintDirectionIcon =
  | 'film-strip'
  | 'arrows-out-line-horizontal'
  | 'arrows-out-line-vertical'
  | 'arrows-out-simple'
  | 'squares-four';

export interface MedicalImagePrintDetail {
  readonly label: string;
  readonly value: string;
  readonly wide?: boolean;
}

export interface MedicalImagePrintFrame {
  readonly dataUrl: string;
  readonly aspectRatio: number;
  readonly directionLabel: string;
  readonly sliceLabel: string;
  readonly patient?: string;
  readonly series?: string;
  readonly details: readonly MedicalImagePrintDetail[];
  readonly annotationSvg?: string;
}

export interface MedicalImagePrintOptions {
  readonly imagesPerPage: MedicalImagePrintLayout;
  readonly includeAnnotations: boolean;
}

export interface MedicalImagePrintCaptureOptions {
  readonly directionId: MedicalImagePrintDirectionId;
  readonly slices: readonly number[];
  readonly includeAnnotations: boolean;
  readonly signal?: AbortSignal;
}

export interface MedicalImagePrintDirection {
  readonly id: MedicalImagePrintDirectionId;
  readonly label: string;
  readonly icon: MedicalImagePrintDirectionIcon;
  readonly count: number;
  readonly current: number;
}

export function columnsForMedicalImagePrint(layout: MedicalImagePrintLayout): number {
  const count = Math.max(1, Math.round(layout));
  if (count === 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
}

export function medicalImagePrintSlices(
  from: number,
  to: number,
  step: number,
  count: number,
): readonly number[] {
  const limit = Math.max(0, Math.floor(count));
  if (limit === 0) return [];
  const start = Math.min(limit, Math.max(1, Math.round(from)));
  const end = Math.min(limit, Math.max(1, Math.round(to)));
  const increment = Math.max(1, Math.round(step));
  const direction = start <= end ? 1 : -1;
  const result: number[] = [];
  for (
    let slice = start;
    direction > 0 ? slice <= end : slice >= end;
    slice += direction * increment
  ) {
    result.push(slice);
  }
  return result;
}

export function captureMedicalImageFrame(
  stage: HTMLElement,
  includeAnnotations: boolean,
  render?: () => void,
): Pick<MedicalImagePrintFrame, 'dataUrl' | 'aspectRatio' | 'annotationSvg'> | null {
  const canvas = Array.from(stage.querySelectorAll<HTMLCanvasElement>('canvas'))
    .filter((candidate) => candidate.width > 0 && candidate.height > 0)
    .sort((left, right) => right.width * right.height - left.width * left.height)[0];
  if (!canvas) return null;

  const dataUrl = canvasDataUrl(canvas, render);
  const aspectRatio = Math.max(0.1, Math.min(10, canvas.width / canvas.height));
  const svg = includeAnnotations
    ? stage.querySelector<SVGSVGElement>('.medical-image-viewer__annotation-layer')
    : undefined;
  const strokes = svg?.querySelector('.medical-image-viewer__annotation-stroke');
  let annotationSvg: string | undefined;
  if (svg && strokes) {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('class', 'medical-image-print__annotation');
    annotationSvg = clone.outerHTML;
  }
  return { dataUrl, aspectRatio, ...(annotationSvg ? { annotationSvg } : {}) };
}

export function waitForMedicalImagePaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function canvasDataUrl(canvas: HTMLCanvasElement, render?: () => void): string {
  render?.();
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!gl) return canvas.toDataURL('image/png');

  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  if (gl.getError() !== gl.NO_ERROR) return canvas.toDataURL('image/png');

  const imageCanvas = document.createElement('canvas');
  imageCanvas.width = canvas.width;
  imageCanvas.height = canvas.height;
  const context = imageCanvas.getContext('2d');
  if (!context) return canvas.toDataURL('image/png');

  const image = context.createImageData(canvas.width, canvas.height);
  const rowLength = canvas.width * 4;
  for (let row = 0; row < canvas.height; row += 1) {
    const sourceOffset = (canvas.height - row - 1) * rowLength;
    image.data.set(pixels.subarray(sourceOffset, sourceOffset + rowLength), row * rowLength);
  }
  context.putImageData(image, 0, 0);
  return imageCanvas.toDataURL('image/png');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function printFrameHtml(
  frame: MedicalImagePrintFrame,
  includeAnnotations: boolean,
  single: boolean,
): string {
  const overlay = medicalImagePrintOverlay(frame);
  const grid = frame.directionLabel.includes('· сетка');
  return `<figure class="medical-image-print__frame${single ? ' medical-image-print__frame--single' : ' medical-image-print__frame--grid'}">
  <div class="medical-image-print__media${grid ? ' medical-image-print__media--grid' : ''}" style="--medical-image-print-aspect: ${String(frame.aspectRatio)};">
    <img class="medical-image-print__image" src="${escapeHtml(frame.dataUrl)}" alt="${escapeHtml(`${frame.directionLabel}, ${frame.sliceLabel}`)}" />
    ${includeAnnotations && frame.annotationSvg ? `<div class="medical-image-print__annotation-host">${frame.annotationSvg}</div>` : ''}
    <div class="medical-image-print__overlay${grid ? ' medical-image-print__overlay--grid' : ''}">
      <span class="medical-image-print__overlay-top">${escapeHtml(overlay.top)}</span>
      <span class="medical-image-print__overlay-bottom">${escapeHtml(overlay.bottom)}</span>
    </div>
  </div>
</figure>`;
}

export function medicalImagePrintOverlay(frame: MedicalImagePrintFrame): {
  readonly top: string;
  readonly bottom: string;
} {
  const top = [
    frame.patient ? `Пациент: ${frame.patient}` : '',
    frame.series ? `Серия: ${frame.series}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const direction = frame.directionLabel.startsWith('Акси')
    ? 'AX'
    : frame.directionLabel.startsWith('Корон')
      ? 'COR'
      : frame.directionLabel.startsWith('Сагит')
        ? 'SAG'
        : frame.directionLabel;
  const slice = frame.sliceLabel.match(/(\d+)\s*(?:–|-)\s*(\d+)\s+из\s+(\d+)/u);
  const singleSlice = frame.sliceLabel.match(/(\d+)\s+из\s+(\d+)/u);
  return {
    top,
    bottom: slice
      ? `${direction} · ${slice[1]}–${slice[2]}/${slice[3]}`
      : singleSlice
        ? `${direction} · ${singleSlice[1]}/${singleSlice[2]}`
        : `${direction} · ${frame.sliceLabel}`,
  };
}

export function buildMedicalImagePrintHtml(
  title: string,
  frames: readonly MedicalImagePrintFrame[],
  options: MedicalImagePrintOptions,
): string {
  const pages: string[] = [];
  for (let offset = 0; offset < frames.length; offset += options.imagesPerPage) {
    const pageFrames = frames.slice(offset, offset + options.imagesPerPage);
    const single = options.imagesPerPage === 1 && pageFrames.length === 1;
    const pageNumber = Math.floor(offset / options.imagesPerPage) + 1;
    pages.push(`<main class="medical-image-print__page${single ? ' medical-image-print__page--single' : ''}">
  <header class="medical-image-print__header">
    <span class="medical-image-print__kicker">MiniMed · медицинская печать</span>
    <strong class="medical-image-print__title">${escapeHtml(title)}</strong>
    <span class="medical-image-print__page-number">Страница ${String(pageNumber)}</span>
  </header>
  <div class="medical-image-print__grid${single ? ' medical-image-print__grid--single' : ''}" style="--medical-image-print-columns: ${String(columnsForMedicalImagePrint(options.imagesPerPage))};">
    ${pageFrames.map((frame) => printFrameHtml(frame, options.includeAnnotations, single)).join('')}
  </div>
</main>`);
  }

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4 portrait; margin: 8mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { width: 194mm; color: #171914; font-family: Arial, Helvetica, sans-serif; }
    .medical-image-print__page { display: flex; width: 194mm; height: 281mm; flex-direction: column; overflow: hidden; break-after: page; page-break-after: always; }
    .medical-image-print__page:last-child { break-after: auto; page-break-after: auto; }
    .medical-image-print__header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 1mm 4mm; flex: 0 0 auto; align-items: end; min-height: 12mm; padding-bottom: 2mm; border-bottom: 0.7pt solid #405b4e; }
    .medical-image-print__kicker { grid-column: 1 / -1; color: #405b4e; font-size: 7pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    .medical-image-print__title { min-width: 0; overflow: hidden; font-size: 13pt; line-height: 1.1; text-overflow: ellipsis; white-space: nowrap; }
    .medical-image-print__page-number { color: #585349; font-size: 7pt; white-space: nowrap; }
    .medical-image-print__grid { display: grid; grid-template-columns: repeat(var(--medical-image-print-columns), minmax(0, 1fr)); grid-auto-rows: minmax(0, 1fr); gap: 3mm; min-height: 0; flex: 1 1 auto; padding-top: 3mm; }
    .medical-image-print__grid--single { display: block; }
    .medical-image-print__frame { display: grid; min-width: 0; min-height: 0; margin: 0; overflow: hidden; break-inside: avoid; }
    .medical-image-print__frame--single,
    .medical-image-print__frame--grid { grid-template-rows: minmax(0, 1fr); }
    .medical-image-print__media { position: relative; min-height: 0; overflow: hidden; aspect-ratio: var(--medical-image-print-aspect); background: #050607; }
    .medical-image-print__frame--single .medical-image-print__media { height: 100%; aspect-ratio: auto; }
    .medical-image-print__image { display: block; width: 100%; height: 100%; object-fit: contain; }
    .medical-image-print__annotation-host,
    .medical-image-print__annotation { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
    .medical-image-print__annotation { overflow: visible; }
    .medical-image-viewer__annotation-stroke { fill: none; stroke-linecap: round; stroke-linejoin: round; stroke-width: 3; vector-effect: non-scaling-stroke; }
    .medical-image-viewer__annotation-stroke--red { stroke: #ff4f5e; }
    .medical-image-viewer__annotation-stroke--blue { stroke: #4f8fff; }
    .medical-image-print__overlay { position: absolute; z-index: 1; inset: 0; display: flex; flex-direction: column; justify-content: space-between; padding: 1.5mm; color: #fff; font-size: 6.5pt; line-height: 1.15; pointer-events: none; }
    .medical-image-print__overlay--grid { justify-content: center; align-items: center; gap: 1mm; text-align: center; }
    .medical-image-print__overlay-top,
    .medical-image-print__overlay-bottom { display: block; min-height: 1em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .medical-image-print__overlay-bottom { align-self: flex-end; }
    @media print { .medical-image-print__page { break-after: page; } .medical-image-print__page:last-child { break-after: auto; } }
  </style>
</head>
<body>${pages.join('')}</body>
</html>`;
}
