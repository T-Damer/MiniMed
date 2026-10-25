import type { MedicalDocumentSummary } from '@localmed/contracts';

import { formatFetchDate } from '@/features/medications/instruction-source';

export interface ReaderDocumentSource {
  readonly name: string;
  readonly url: string | null;
  readonly fetchedOn: string | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Where a document's text comes from, for «⋯» → «Информация»: its publisher (or the page's host)
 * and the page, when the metadata names them. Drug instructions have their own line
 * (`DrugReferenceFooter`), so they give null here.
 */
export function readerDocumentSource(
  document: Pick<MedicalDocumentSummary, 'sourceType' | 'metadata'>,
): ReaderDocumentSource | null {
  if (document.sourceType === 'official_drug_instruction') return null;
  const metadata = document.metadata ?? {};
  const page = text(metadata['officialSourceUrl']);
  const url = page && /^https:\/\//u.test(page) ? page : null;
  const name =
    text(metadata['publisher']) ?? (url ? new URL(url).hostname.replace(/^www\./u, '') : null);
  if (!name) return null;
  return { name, url, fetchedOn: formatFetchDate(text(metadata['fetchedAt'])) };
}
