import { Capacitor } from '@capacitor/core';

import { PrintManager } from '@/features/printing/print-manager';
import { shareSystemFile } from '@/state/native-share';

function pdfFileName(title: string): string {
  const safe = title
    .replace(/\.pdf$/iu, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64);
  return `${safe || 'minimed-document'}.pdf`;
}

/** Prints the original file (the system print dialog), not a re-typeset copy. */
export function printPdf(blob: Blob, title: string): Promise<boolean> {
  return PrintManager.original(blob, title);
}

/**
 * «Открыть в системе»: the Android share sheet / system PDF app on the phone, a browser tab with
 * the browser's own PDF viewer on the web. Returns false when the system refused to open it.
 */
export async function openPdfInSystem(blob: Blob, title: string): Promise<boolean> {
  const typed =
    blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
  if (Capacitor.isNativePlatform()) {
    const result = await shareSystemFile({
      title,
      fileName: pdfFileName(title),
      mimeType: 'application/pdf',
      blob: typed,
    });
    return result !== 'cancelled';
  }
  const url = URL.createObjectURL(typed);
  const opened = window.open(url, '_blank', 'noopener');
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
  if (opened) return true;
  URL.revokeObjectURL(url);
  const result = await shareSystemFile({
    title,
    fileName: pdfFileName(title),
    mimeType: 'application/pdf',
    blob: typed,
  });
  return result !== 'cancelled';
}
