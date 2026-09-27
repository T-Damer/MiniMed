import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import previewCatalog from '@/features/modules/catalog.preview.json';
import {
  applyLocalReferenceDescriptors,
  mergeLocalReferenceDescriptor,
} from '@/features/modules/local-definition-reference';

const entry = (version: string) =>
  ({ id: 'minimed.definition.reference.ru', version }) as unknown as ContentModuleCatalogEntry;
const other = { id: 'minimed.core.ru', version: '1' } as unknown as ContentModuleCatalogEntry;

describe('mergeLocalReferenceDescriptor', () => {
  it('adds a local edition, or replaces the published entry with the same id in place', () => {
    expect(mergeLocalReferenceDescriptor([other], entry('local')).map((m) => m.version)).toEqual([
      '1',
      'local',
    ]);
    expect(
      mergeLocalReferenceDescriptor([entry('2026.9.27'), other], entry('local')).map(
        (m) => m.version,
      ),
    ).toEqual(['local', '1']);
  });
});

describe('applyLocalReferenceDescriptors', () => {
  // What prepare-definition-reference.py writes to catalog.definition-reference.local.json.
  const published = previewCatalog.modules.find(
    (module) => module.id === 'minimed.definition.reference.ru',
  );
  if (!published) throw new Error('The preview catalog lost its reference entry.');
  const localJson = {
    module: { ...published, version: '2026.9.28' },
    fileName: 'minimed.definition.reference.2026.9.28.db.gz',
  };

  it('leaves the catalog unchanged without a page to serve the archive from', () => {
    expect(applyLocalReferenceDescriptors([other], [localJson], undefined)).toEqual([other]);
  });

  it('points the local edition at the archive next to the page', () => {
    const [, local] = applyLocalReferenceDescriptors(
      [other],
      [localJson],
      'http://localhost:5173/',
    );
    expect(local?.version).toBe('2026.9.28');
    expect(local?.artifacts[0]?.url).toBe(
      'http://localhost:5173/content/definition-reference/minimed.definition.reference.2026.9.28.db.gz',
    );
  });

  it('rejects a descriptor that is not the preparer output', () => {
    expect(() =>
      applyLocalReferenceDescriptors([], [{ ...localJson, fileName: '../x.db.gz' }], 'http://a/'),
    ).toThrow('Invalid local reference descriptor');
  });
});
