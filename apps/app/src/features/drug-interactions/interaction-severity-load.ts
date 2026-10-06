import type { MedicalCore } from '@localmed/contracts';

import {
  parseSeverityText,
  readSeverityProvenance,
  SEVERITY_MANIFEST_DOCUMENT_ID,
  type SeverityLevel,
  type SeverityProvenance,
  severityDocumentText,
} from './interaction-severity';

/**
 * Reads the installed DDInter severity module through the core (INT2). The module is optional: a
 * core without it answers «not found» for its documents, which means «no labels», never an error.
 */
export async function loadSeverityProvenance(
  core: MedicalCore,
): Promise<SeverityProvenance | null> {
  const result = await core.getDocument(SEVERITY_MANIFEST_DOCUMENT_ID);
  return result.ok ? readSeverityProvenance(result.value) : null;
}

/** The partners (and levels) listed in one severity document; empty when it does not exist. */
export async function loadSeverityPartners(
  core: MedicalCore,
  documentId: string,
): Promise<ReadonlyMap<string, SeverityLevel>> {
  const result = await core.getDocument(documentId);
  return result.ok ? parseSeverityText(severityDocumentText(result.value)) : new Map();
}
