import { isSameDocumentFamily } from '@localmed/core';

/**
 * A module pointer is the catalog's stand-in for a document that is not installed yet:
 * `core.catalog.pointer.<kind>.<target document id>-<16 hex digits>`. Every pointer of the bundled
 * core (clinical, medication and reference kinds) follows this shape, and the part between the kind
 * and the hash is exactly the id of the document it leads to.
 */
const POINTER_DOCUMENT_ID = /^core\.catalog\.pointer\.[a-z]+\.(.+)-[0-9a-f]{16}$/u;

/** The id of the document a pointer stands for; any other id is already its own identity. */
export function canonicalDocumentId(documentId: string): string {
  return POINTER_DOCUMENT_ID.exec(documentId)?.[1] ?? documentId;
}

/**
 * True when two ids are one document as far as the reader's trail is concerned: the pointer and the
 * installed document it became, a summary and its full text, a revision of the same work.
 */
export function isSameDocumentIdentity(leftId: string, rightId: string): boolean {
  return isSameDocumentFamily(canonicalDocumentId(leftId), canonicalDocumentId(rightId));
}
