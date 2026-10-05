import { pluralRu } from '@/i18n/labels';
import { formatStorageSize } from './settings-status';

/**
 * Examples on the «Справочные изображения» page: a few real illustrations of the set. Downloaded
 * ones are read from the device; before the download the page falls back to a handful of originals
 * bundled with the app (`content/reference-images-preview/`, see
 * `scripts/build-reference-image-previews.ts`).
 */
export interface ReferenceImageExample {
  readonly alt: string;
  readonly url: string;
  readonly sourceUrl: string;
}

export type ReferenceImageExamples =
  | { readonly origin: 'device'; readonly images: readonly ReferenceImageExample[] }
  | { readonly origin: 'bundled'; readonly images: readonly ReferenceImageExample[] }
  | { readonly origin: 'none'; readonly images: readonly [] };

export const REFERENCE_IMAGE_EXAMPLE_LIMIT = 6;

const PREVIEW_PATH = /^assets\/[a-f0-9]{64}\.(?:jpg|jpeg|png|gif|webp)$/u;
const SOURCE_ORIGIN = 'https://www.krasotaimedicina.ru';

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

/** Reads the bundled preview index; an entry that is not a plain asset path of the set is dropped. */
export function parseBundledPreviewIndex(
  value: unknown,
  resolveUrl: (path: string) => string,
): readonly ReferenceImageExample[] {
  const images = record(value)?.['images'];
  if (!Array.isArray(images)) return [];
  const examples: ReferenceImageExample[] = [];
  for (const item of images) {
    const entry = record(item);
    const alt = entry?.['alt'];
    const path = entry?.['path'];
    const sourceUrl = entry?.['sourceUrl'];
    if (
      typeof alt !== 'string' ||
      alt.trim() === '' ||
      typeof path !== 'string' ||
      !PREVIEW_PATH.test(path) ||
      typeof sourceUrl !== 'string' ||
      !sourceUrl.startsWith(`${SOURCE_ORIGIN}/`)
    ) {
      continue;
    }
    examples.push({ alt: alt.trim(), url: resolveUrl(path), sourceUrl });
  }
  return examples;
}

/** Downloaded images win; otherwise the bundled originals; otherwise nothing to show. */
export function chooseReferenceImageExamples(
  downloaded: readonly ReferenceImageExample[],
  bundled: readonly ReferenceImageExample[],
  limit = REFERENCE_IMAGE_EXAMPLE_LIMIT,
): ReferenceImageExamples {
  if (downloaded.length > 0) return { origin: 'device', images: downloaded.slice(0, limit) };
  if (bundled.length > 0) return { origin: 'bundled', images: bundled.slice(0, limit) };
  return { origin: 'none', images: [] };
}

export interface ReferenceImagesContents {
  readonly documents: number;
  readonly files: number;
  readonly bytes: number;
}

function groupedNumber(value: number): string {
  return value.toLocaleString('ru-RU').replace(/ /gu, ' ');
}

/** «9 123 иллюстрации к 5 932 статьям · 462 МБ». */
export function referenceImagesContentsLabel(contents: ReferenceImagesContents): string {
  const files = `${groupedNumber(contents.files)} ${pluralRu(
    contents.files,
    'иллюстрация',
    'иллюстрации',
    'иллюстраций',
  )}`;
  const documents = `${groupedNumber(contents.documents)} ${pluralRu(
    contents.documents,
    'статье',
    'статьям',
    'статьям',
  )}`;
  return `${files} к ${documents} · ${formatStorageSize(contents.bytes)}`;
}

/** The sentence under the examples: where they come from and what the download adds. */
export function referenceImageExamplesNote(examples: ReferenceImageExamples): string {
  switch (examples.origin) {
    case 'device':
      return 'Это уже скачанные на устройство иллюстрации: они открываются без интернета.';
    case 'bundled':
      return 'Примеры встроены в приложение и показаны без загрузки. Остальные иллюстрации скачиваются отдельно и дальше работают без интернета.';
    case 'none':
      return 'Примеры сейчас недоступны. Иллюстрации скачиваются отдельно и дальше работают без интернета.';
  }
}
