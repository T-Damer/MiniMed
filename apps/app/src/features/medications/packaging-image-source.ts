import {
  PACKAGING_IMAGE_SOURCE_NAME,
  type ResolvedMedicationPackagingImage,
} from '@/features/medications/medication-packaging-images';

export interface PackagingImageSourceView {
  /** The site the photo comes from. */
  readonly siteName: string;
  /** Address of the source file: an https link, or null when the pack carries none that is safe. */
  readonly url: string | null;
  /** The address as shown: host and path without the scheme. */
  readonly urlLabel: string | null;
  /** When the file was fetched, as «13 октября 2026 г.»; null for a pack without the date. */
  readonly fetched: string | null;
}

const FETCH_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

export function formatPackagingImageFetchDate(value: string | null): string | null {
  const match = value ? FETCH_DATE.exec(value) : null;
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** What the «?» popover of a packaging image shows. */
export function packagingImageSourceView(
  image: Pick<ResolvedMedicationPackagingImage, 'sourceUrl' | 'fetchedAt'>,
): PackagingImageSourceView {
  let url: string | null = null;
  let urlLabel: string | null = null;
  try {
    const parsed = new URL(image.sourceUrl);
    if (parsed.protocol === 'https:') {
      url = parsed.href;
      urlLabel = `${parsed.host}${parsed.pathname}`;
    }
  } catch {
    url = null;
  }
  return {
    siteName: PACKAGING_IMAGE_SOURCE_NAME,
    url,
    urlLabel,
    fetched: formatPackagingImageFetchDate(image.fetchedAt),
  };
}
