import { describe, expect, it } from 'vitest';

import rawCatalog from '../../../apps/app/src/features/modules/catalog.preview.json';
import { addClinicalDeltaModules } from '../../../scripts/add-clinical-delta-modules';
import { ContentModuleCatalogSchema, serializeContentModuleCatalog } from '../src/content-modules';

type Raw = Record<string, unknown>;

const modules = rawCatalog.modules as unknown as Raw[];
const core = modules.find((module) => module['kind'] === 'core') as Raw;
const [template] = modules.filter((module) =>
  String(module['id']).startsWith('minimed.clinical.recommendation.'),
) as [Raw];
const category = String(template['collection']);

function recommendation(officialId: string, extra: Raw = {}): Raw {
  const id = `minimed.clinical.recommendation.${officialId}`;
  const table = template['documentTable'] as { indexArtifactId: string; rows: unknown[][] };
  const artifactId = `${id}-index-test`;
  const digest = String(template['sourceSetDigest']);
  return {
    ...template,
    id,
    tags: ['individual-recommendation', officialId],
    artifacts: [
      {
        ...(template['artifacts'] as Raw[])[0],
        id: artifactId,
        sourceSetDigest: digest,
      },
    ],
    documentTable: {
      indexArtifactId: artifactId,
      rows: [[`kr.rf.${officialId}`, `@${officialId}`, String(table.rows[0]?.[2]), null]],
    },
    ...extra,
  };
}

const base = (): Raw => ({
  ...rawCatalog,
  categories: [{ id: category, title: 'Test', recommendationCount: 99, specialties: [] }],
  modules: [core, recommendation('1_1'), recommendation('2_1')],
});

describe('addClinicalDeltaModules', () => {
  it('adds edition modules, marks the replaced edition and keeps its artifact untouched', () => {
    const next = addClinicalDeltaModules(
      base(),
      [
        recommendation('1_2', {
          compatibility: { ...(template['compatibility'] as Raw), minAppVersion: '0.6.0' },
        }),
      ],
      {
        minAppVersion: '0.6.46',
        supersededOfficialIds: ['1_1'],
        publishedAt: '2026-10-02T06:00:00Z',
      },
    );
    const parsed = ContentModuleCatalogSchema.parse(
      JSON.parse(serializeContentModuleCatalog(next)),
    );

    expect(parsed.modules.map((module) => module.id)).toEqual([
      core['id'],
      'minimed.clinical.recommendation.1_1',
      'minimed.clinical.recommendation.2_1',
      'minimed.clinical.recommendation.1_2',
    ]);
    const [replaced, current, added] = parsed.modules.slice(1);
    expect(replaced?.documents.map((document) => document.status)).toEqual(['superseded']);
    expect(current?.documents.map((document) => document.status)).toEqual(['active']);
    expect(added?.compatibility.minAppVersion).toBe('0.6.46');
    expect(parsed.publishedAt).toBe('2026-10-02T06:00:00Z');
    expect(replaced?.sourceSetDigest).toBe(template['sourceSetDigest']);
    expect(replaced?.artifacts[0]?.url).toBe((template['artifacts'] as Raw[])[0]?.['url']);
    // 3 listed, one replaced: two current recommendations.
    expect(parsed.categories[0]?.recommendationCount).toBe(2);
  });

  it('refuses an edition that is already a module and an unknown category', () => {
    expect(() =>
      addClinicalDeltaModules(base(), [recommendation('1_1')], {
        minAppVersion: '0.6.46',
        supersededOfficialIds: [],
      }),
    ).toThrow(/already listed/u);
    expect(() =>
      addClinicalDeltaModules(
        base(),
        [recommendation('3_1', { collection: 'minimed.clinical.nowhere' })],
        {
          minAppVersion: '0.6.46',
          supersededOfficialIds: [],
        },
      ),
    ).toThrow(/Unknown category/u);
    expect(() =>
      addClinicalDeltaModules(base(), [], {
        minAppVersion: '0.6.46',
        supersededOfficialIds: ['9_9'],
      }),
    ).toThrow(/not listed/u);
  });
});
