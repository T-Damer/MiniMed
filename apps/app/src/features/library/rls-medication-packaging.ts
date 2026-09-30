import type { MedicalDocument } from '@localmed/contracts';

export interface RlsMedicationPackagingLink {
  readonly medicationEntityId: string;
  readonly name: string;
  readonly packagingDocumentId: string;
  readonly sourceUrl: string;
}

/** Only explicit source-local relationships; trade-name similarity never creates a link. */
export function rlsMedicationPackagingLinks(
  document: Pick<MedicalDocument, 'metadata'>,
): readonly RlsMedicationPackagingLink[] {
  // biome-ignore lint/complexity/useLiteralKeys: source metadata has an index signature.
  const values = document.metadata['rlsMedicationPackaging'];
  if (!Array.isArray(values)) return [];
  const entries: readonly unknown[] = values;
  const links = new Map<string, RlsMedicationPackagingLink>();
  for (const value of entries) {
    if (!value || typeof value !== 'object') continue;
    const { medicationEntityId, name, packagingDocumentId, sourceUrl } = value as Readonly<
      Record<string, unknown>
    >;
    if (
      typeof medicationEntityId !== 'string' ||
      !medicationEntityId.startsWith('medication.brand.') ||
      typeof name !== 'string' ||
      !name.trim() ||
      typeof packagingDocumentId !== 'string' ||
      !packagingDocumentId.startsWith('rls.packaging.') ||
      typeof sourceUrl !== 'string' ||
      !URL.canParse(sourceUrl)
    )
      continue;
    const url = new URL(sourceUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'www.rlsnet.ru') continue;
    links.set(packagingDocumentId, { medicationEntityId, name, packagingDocumentId, sourceUrl });
  }
  return [...links.values()];
}
