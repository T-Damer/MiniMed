/**
 * A worksheet's sources as the shared «Источники» list in the «?» shows them (owner 2026-11-08,
 * 2026-11-09): named rows; a КР the app has opens in the reader, a web source on its site.
 */
import type { HelpSource } from '@/components/HelpSources';
import type { UserWorksheet } from '@/state/user-worksheet-format';

export function worksheetHelpSources(worksheet: UserWorksheet): readonly HelpSource[] {
  return worksheet.sources.map((source) => ({
    title: source.title,
    publisher: source.publisher,
    year: source.year,
    ...(source.detail ? { detail: source.detail } : {}),
    ...(source.url ? { url: source.url } : {}),
    ...(source.documentId ? { document: { documentId: source.documentId } } : {}),
  }));
}
