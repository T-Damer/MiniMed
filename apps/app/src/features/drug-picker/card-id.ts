const CARD_PREFIX = 'esklp.mnn.';
const POINTER = /^core\.catalog\.pointer\.medication\.esklp\.mnn\.(.+)-[0-9a-f]{16}$/u;

/** `esklp.mnn.<slug>` or its core pointer → `<slug>`; null for any other document. */
export function cardSlugOfDocumentId(documentId: string): string | null {
  if (documentId.startsWith(CARD_PREFIX)) return documentId.slice(CARD_PREFIX.length);
  return POINTER.exec(documentId)?.[1] ?? null;
}
