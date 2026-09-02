import type { MedicalDocumentSummary } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  type ClinicalMedicationLink,
  parseClinicalMedicationLinks,
} from '@/features/medications/clinical-medication-links';

const MNN_DOCUMENT_ID = 'esklp.mnn.ibuprofen';
const TARGET_DOCUMENT_ID = 'clinical.pneumonia';

type RawLink = Record<string, unknown>;

function link(overrides: RawLink = {}): RawLink {
  return {
    relationId: 'relation.ibuprofen.pneumonia',
    mnnDocumentId: MNN_DOCUMENT_ID,
    inn: 'Ибупрофен',
    targetDocumentId: TARGET_DOCUMENT_ID,
    predicate: 'recommended-for',
    relationStatus: 'guideline',
    reviewStatus: 'proposed',
    ageGroups: ['children'],
    evidenceQuote: 'Ибупрофен рекомендуется при пневмонии.',
    sourceAnchor: 'chunk-1',
    ...overrides,
  };
}

function pointerSummary(
  id: string,
  title: string,
  links: readonly unknown[] = [link()],
  metadataOverrides: Record<string, unknown> = {},
): MedicalDocumentSummary {
  return {
    id,
    title,
    shortTitle: null,
    sourceType: 'core_catalog_pointer',
    status: 'active',
    specialties: [],
    versionId: `${id}@1`,
    versionLabel: '1',
    effectiveFrom: null,
    metadata: {
      contentMode: 'module-pointer',
      catalogFamily: 'clinical',
      targetDocumentId: TARGET_DOCUMENT_ID,
      clinicalMedicationLinks: links,
      ...metadataOverrides,
    },
  };
}

describe('parseClinicalMedicationLinks', () => {
  it('filters summaries and links by the clinical pointer metadata contract', () => {
    const accepted = pointerSummary('pointer.accepted', 'Пневмония');
    const wrongSource = { ...accepted, sourceType: 'official_registry_summary' };
    const wrongMode = pointerSummary('pointer.mode', 'Неверный режим', [link()], {
      contentMode: 'registry-normalized',
    });
    const wrongFamily = pointerSummary('pointer.family', 'Неверное семейство', [link()], {
      catalogFamily: 'medication',
    });
    const wrongTarget = pointerSummary('pointer.target', 'Неверная цель', [
      link({ targetDocumentId: 'clinical.other' }),
    ]);

    expect(
      parseClinicalMedicationLinks(
        [accepted, wrongSource, wrongMode, wrongFamily, wrongTarget],
        MNN_DOCUMENT_ID,
      ),
    ).toEqual([
      {
        pointerDocumentId: 'pointer.accepted',
        targetDocumentId: TARGET_DOCUMENT_ID,
        relationId: 'relation.ibuprofen.pneumonia',
        recommendationTitle: 'Пневмония',
        mnnDocumentId: MNN_DOCUMENT_ID,
        inn: 'Ибупрофен',
        ageGroups: ['children'],
        evidenceQuote: 'Ибупрофен рекомендуется при пневмонии.',
        sourceAnchor: 'chunk-1',
      },
    ] satisfies readonly ClinicalMedicationLink[]);
  });

  it('skips malformed relation items and accepts an omitted ageGroups field', () => {
    const malformedLinks = [
      link({ relationId: '' }),
      link({ mnnDocumentId: 42 }),
      link({ inn: null }),
      link({ targetDocumentId: 42 }),
      link({ predicate: 'mentioned-for' }),
      link({ relationStatus: 'reference-only' }),
      link({ reviewStatus: 'reviewed' }),
      link({ evidenceQuote: ' ' }),
      link({ sourceAnchor: [] }),
      link({ ageGroups: 'children' }),
      link({ ageGroups: ['children', 3] }),
      null,
      'not an object',
    ];

    expect(
      parseClinicalMedicationLinks(
        [
          pointerSummary('pointer.malformed', 'Пневмония', [
            ...malformedLinks,
            link({ ageGroups: undefined }),
          ]),
        ],
        MNN_DOCUMENT_ID,
      ),
    ).toEqual([
      expect.objectContaining({ relationId: 'relation.ibuprofen.pneumonia', ageGroups: [] }),
    ]);
  });

  it('requires the exact MNN identity so a Nurofen combination does not cross-link', () => {
    const links = parseClinicalMedicationLinks(
      [
        pointerSummary('pointer.nurofen', 'Нурофен', [
          link({
            relationId: 'relation.nurofen-plus',
            mnnDocumentId: 'esklp.mnn.ibuprofen-codeine',
            inn: 'Ибупрофен+Кодеин',
            evidenceQuote: 'Нурофен Плюс рекомендуется при боли.',
          }),
          link({ relationId: 'relation.nurofen' }),
        ]),
      ],
      MNN_DOCUMENT_ID,
    );

    expect(links.map((item) => item.relationId)).toEqual(['relation.nurofen']);
  });

  it('deduplicates by relationId, sorts deterministically, and freezes the result', () => {
    const duplicate = link({ relationId: 'relation.same' });
    const links = parseClinicalMedicationLinks(
      [
        pointerSummary('pointer.z', 'Пневмония', [link({ relationId: 'relation.z' }), duplicate]),
        pointerSummary('pointer.a', 'Астма', [
          link({ relationId: 'relation.b' }),
          link({ relationId: 'relation.a' }),
        ]),
        pointerSummary('pointer.duplicate', 'Другая рекомендация', [duplicate]),
      ],
      MNN_DOCUMENT_ID,
    );

    expect(
      links.map(({ recommendationTitle, relationId }) => [recommendationTitle, relationId]),
    ).toEqual([
      ['Астма', 'relation.a'],
      ['Астма', 'relation.b'],
      ['Пневмония', 'relation.same'],
      ['Пневмония', 'relation.z'],
    ]);
    expect(links).toHaveLength(4);
    expect(Object.isFrozen(links)).toBe(true);
    expect(Object.isFrozen(links[0])).toBe(true);
    expect(Object.isFrozen(links[0]?.ageGroups)).toBe(true);
  });
});
