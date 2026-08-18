export function shouldReloadOfficialDocument(
  currentDocumentId: string | undefined,
  nextDocumentId: string,
  inFlightDocumentId: string | null,
): boolean {
  if (inFlightDocumentId === nextDocumentId) return false;
  if (currentDocumentId === nextDocumentId) return false;
  return true;
}
