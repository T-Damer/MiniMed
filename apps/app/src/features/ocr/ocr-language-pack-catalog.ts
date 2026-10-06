/**
 * The OCR language pack (Tesseract «tessdata» 4.0.0, русский + английский) is not part of the app
 * bundle: it is downloaded once, after the user agrees, and then OCR works offline. This module is
 * the pure part: what the pack is, where it comes from and how a downloaded file is accepted.
 */

/** The pinned upstream commit of naptha/tessdata (branch gh-pages) the files below were taken from. */
const TESSDATA_COMMIT = '806cd9adc8c6e8abc11c782db1818c990576bebc';
const TESSDATA_RELEASE_DIR = '4.0.0';

export type OcrLanguage = 'eng' | 'rus';

export interface OcrLanguagePackFile {
  readonly language: OcrLanguage;
  /** Ordered mirrors of the same bytes; the next one is tried only when the previous one fails. */
  readonly sources: readonly string[];
  /** Size and SHA-256 of the gzip file as served, which is what is stored and what tesseract reads. */
  readonly bytes: number;
  readonly sha256: string;
}

function sources(language: OcrLanguage): readonly string[] {
  const file = `${TESSDATA_RELEASE_DIR}/${language}.traineddata.gz`;
  return [
    `https://cdn.jsdelivr.net/gh/naptha/tessdata@${TESSDATA_COMMIT}/${file}`,
    `https://raw.githubusercontent.com/naptha/tessdata/${TESSDATA_COMMIT}/${file}`,
  ];
}

/** Changing the files means a new version: the stored descriptor is compared with it. */
export const OCR_LANGUAGE_PACK_VERSION = `tessdata-${TESSDATA_RELEASE_DIR}`;

export const OCR_LANGUAGE_PACK_FILES: readonly OcrLanguagePackFile[] = [
  {
    language: 'eng',
    sources: sources('eng'),
    bytes: 10_923_060,
    sha256: 'ed350f3752f81ee8f38769edc14d92d997dababe23b565c59879372cc46a2468',
  },
  {
    language: 'rus',
    sources: sources('rus'),
    bytes: 8_634_337,
    sha256: '63a48ae166be2bb9862839b6f75e11afbac5e3be5bd5fa9a155ea43d5cdf9575',
  },
];

export const OCR_LANGUAGE_PACK_TOTAL_BYTES = OCR_LANGUAGE_PACK_FILES.reduce(
  (sum, file) => sum + file.bytes,
  0,
);

/** The languages passed to tesseract, in the order it expects (`rus+eng`). */
export const OCR_LANGUAGES = 'rus+eng';

/** Decimal megabytes with a Russian decimal comma, like the downloads list: «19,6 МБ». */
export function formatOcrPackSize(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1).replace('.', ',')} МБ`;
}

export const OCR_LANGUAGE_PACK_SIZE_LABEL = formatOcrPackSize(OCR_LANGUAGE_PACK_TOTAL_BYTES);

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A downloaded file is stored only when both its size and its SHA-256 match the catalog. */
export async function verifyOcrLanguageFile(
  file: OcrLanguagePackFile,
  bytes: Uint8Array,
): Promise<void> {
  if (bytes.byteLength !== file.bytes) {
    throw new Error(`Языковой файл ${file.language}: размер не совпадает с каталогом.`);
  }
  if ((await sha256Hex(bytes)) !== file.sha256) {
    throw new Error(`Языковой файл ${file.language}: контрольная сумма не совпадает с каталогом.`);
  }
}

export interface OcrLanguagePackDescriptor {
  readonly version: string;
  readonly installedAt: string;
  readonly files: readonly { readonly language: OcrLanguage; readonly sha256: string }[];
}

export function buildOcrLanguagePackDescriptor(installedAt: string): OcrLanguagePackDescriptor {
  return {
    version: OCR_LANGUAGE_PACK_VERSION,
    installedAt,
    files: OCR_LANGUAGE_PACK_FILES.map(({ language, sha256 }) => ({ language, sha256 })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a stored descriptor; anything that is not exactly the current catalog is «not installed». */
export function parseOcrLanguagePackDescriptor(raw: unknown): OcrLanguagePackDescriptor | null {
  if (!isRecord(raw) || raw['version'] !== OCR_LANGUAGE_PACK_VERSION) return null;
  const installedAt = raw['installedAt'];
  const files = raw['files'];
  if (typeof installedAt !== 'string' || !Array.isArray(files)) return null;
  if (files.length !== OCR_LANGUAGE_PACK_FILES.length) return null;
  for (const expected of OCR_LANGUAGE_PACK_FILES) {
    const stored = files.find(
      (item: unknown) => isRecord(item) && item['language'] === expected.language,
    );
    if (!isRecord(stored) || stored['sha256'] !== expected.sha256) return null;
  }
  return buildOcrLanguagePackDescriptor(installedAt);
}
