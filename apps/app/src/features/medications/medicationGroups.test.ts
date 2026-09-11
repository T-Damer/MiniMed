import type { MedicalDocumentSummary } from '@localmed/contracts';
import { expect, it } from 'vitest';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import { medicationDocumentGroups, medicationGroupLabel } from './medicationGroups';

it('uses exact medication manifest membership and source pharmacology', () => {
  const module = MODULE_CATALOG.modules.find(
    (entry) => entry.kind === 'medication' && entry.documents.length,
  );
  if (!module?.documents[0]) throw new Error('Medication fixture missing');
  const document: MedicalDocumentSummary = {
    id: 'pointer',
    title: 'Препарат для детей',
    shortTitle: null,
    sourceType: 'core_catalog_pointer',
    specialties: [],
    status: 'active',
    versionId: '1',
    versionLabel: '1',
    effectiveFrom: null,
    metadata: {
      targetDocumentId: module.documents[0].documentId,
      pharmacotherapeuticGroups: ['Антибиотики', 42],
    },
  };
  expect(medicationDocumentGroups(document)).toEqual([`module:${module.id}`, 'pharm:Антибиотики']);
  expect(medicationGroupLabel(`module:${module.id}`)).toBe(`АТХ: ${module.title}`);
  expect(medicationDocumentGroups({ ...document, metadata: {} })).toEqual([]);
});
