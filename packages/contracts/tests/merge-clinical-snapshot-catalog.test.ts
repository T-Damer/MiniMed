import { describe, expect, it } from 'vitest';

import rawCatalog from '../../../apps/app/src/features/modules/catalog.preview.json';
import { mergeClinicalSnapshotCatalog } from '../../../scripts/merge-clinical-snapshot-catalog';

describe('mergeClinicalSnapshotCatalog', () => {
  it('replaces the prior clinical snapshot and keeps the base catalog', () => {
    const core = rawCatalog.modules[0];
    const recommendation = {
      ...rawCatalog.modules[1],
      id: 'minimed.clinical.recommendation.714_2',
      collection: 'minimed.clinical.respiratory-allergy.ru',
      tags: ['individual-recommendation', '714_2'],
    };
    const base = { ...rawCatalog, modules: [core, recommendation] };
    const next = {
      ...recommendation,
      id: 'minimed.clinical.recommendation.53_2',
      tags: ['individual-recommendation', '53_2'],
    };

    const merged = mergeClinicalSnapshotCatalog(base, {
      snapshotId: 'clinical-2026.07.24-test',
      publishedAt: '2026-07-24T00:00:00Z',
      categories: [
        {
          id: 'minimed.clinical.vascular.ru',
          title: 'Сосудистая хирургия',
          recommendationCount: 1,
          specialties: ['vascular-surgery'],
        },
      ],
      modules: [next],
    });

    expect(merged.modules.map((module) => module.id)).toEqual([core.id, next.id]);
    expect(merged.categories).toHaveLength(1);
  });
});
