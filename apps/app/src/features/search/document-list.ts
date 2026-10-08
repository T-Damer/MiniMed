import type { MedicalDocumentSummary } from '@localmed/contracts';

/**
 * True when a reread document list holds the same documents in the same versions. A core swap
 * rereads the list; an unchanged one must not replace what the catalog and its counts show.
 */
export function sameDocumentList(
  current: readonly MedicalDocumentSummary[],
  next: readonly MedicalDocumentSummary[],
): boolean {
  if (current === next) return true;
  if (current.length !== next.length) return false;
  return current.every((document, index) => {
    const other = next[index];
    return (
      other !== undefined &&
      document.id === other.id &&
      document.versionId === other.versionId &&
      document.sourceChecksum === other.sourceChecksum &&
      document.status === other.status
    );
  });
}
