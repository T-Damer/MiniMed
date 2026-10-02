import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import rawEditions from '@/features/modules/catalog.clinical-editions.json';
import rawCatalog from '@/features/modules/catalog.preview.json';

interface Edition {
  readonly id: string;
  readonly version: number;
  readonly status: 'active' | 'superseded';
  readonly replacedBy: string | null;
  readonly moduleId: string | null;
  readonly rawJsonSha256: string | null;
}

const catalog = ContentModuleCatalogSchema.parse(rawCatalog);
const modulesById = new Map(catalog.modules.map((module) => [module.id, module]));
const codes = rawEditions.codes as readonly { code: number; editions: readonly Edition[] }[];
const editions = codes.flatMap((code) => code.editions);

describe('clinical edition links (catalog.clinical-editions.json)', () => {
  it('orders every chain by version and links each replaced edition to its successor', () => {
    for (const { code, editions: chain } of codes) {
      expect(chain.length, `code ${code}`).toBeGreaterThanOrEqual(2);
      chain.forEach((edition, index) => {
        expect(edition.id.startsWith(`${code}_`)).toBe(true);
        expect(edition.replacedBy).toBe(
          edition.status === 'superseded' ? (chain[index + 1]?.id ?? null) : null,
        );
      });
      expect(chain.filter((edition) => edition.status === 'active').length).toBeLessThanOrEqual(1);
      expect(chain.map((edition) => edition.version)).toEqual(
        [...chain.map((edition) => edition.version)].sort((a, b) => a - b),
      );
    }
  });

  it('names only catalog modules and keeps stored raw checksums for every edition', () => {
    for (const edition of editions) {
      if (edition.moduleId !== null) {
        expect(modulesById.has(edition.moduleId), edition.moduleId).toBe(true);
      }
      expect(edition.rawJsonSha256, edition.id).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it('marks exactly the catalog editions that the registry replaced as superseded', () => {
    const supersededInCatalog = new Set(
      catalog.modules
        .filter(
          (module) =>
            module.id.startsWith('minimed.clinical.recommendation.') &&
            module.documents.length > 0 &&
            module.documents.every((document) => document.status === 'superseded'),
        )
        .map((module) => module.id),
    );
    const replacedWithModule = new Set(
      editions
        .filter((edition) => edition.status === 'superseded' && edition.moduleId !== null)
        .map((edition) => edition.moduleId),
    );
    expect(supersededInCatalog).toEqual(replacedWithModule);
    // A replaced edition's successor must be installable too, or the link points nowhere.
    for (const edition of editions) {
      if (edition.status !== 'superseded' || edition.moduleId === null) continue;
      const successor = editions.find((candidate) => candidate.id === edition.replacedBy);
      expect(successor?.moduleId, `${edition.id} → ${edition.replacedBy}`).not.toBeNull();
    }
  });
});
