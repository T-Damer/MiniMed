import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { mergeLocalReferenceDescriptor } from '@/features/modules/local-definition-reference';

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
