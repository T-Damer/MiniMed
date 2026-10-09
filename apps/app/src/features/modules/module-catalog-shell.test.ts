import { describe, expect, it } from 'vitest';
import rawShell from '@/features/modules/catalog.shell.json';
import { BASE_MODULE_CATALOG } from '@/features/modules/module-catalog';
import {
  BUNDLED_CORE_MODULE,
  SECTION_DOCUMENT_COUNTS,
  TOOL_CATALOG,
} from '@/features/modules/module-catalog-shell';
import {
  deriveModuleCatalogShell,
  deriveSectionDocumentCounts,
} from '@/features/modules/module-catalog-shell-source';

describe('module catalog shell', () => {
  it('matches the release catalog it was generated from (run `bun run catalog:shell`)', () => {
    expect(rawShell).toEqual(
      JSON.parse(JSON.stringify(deriveModuleCatalogShell(BASE_MODULE_CATALOG))),
    );
  });

  it('exposes the bundled core descriptor and every catalog tool in catalog order', () => {
    expect(BUNDLED_CORE_MODULE.id).toBe('minimed.core.ru');
    expect(TOOL_CATALOG.map((tool) => tool.id)).toEqual(
      BASE_MODULE_CATALOG.modules.flatMap((module) => module.tools ?? []).map((tool) => tool.id),
    );
  });

  it('sizes the home sections from the catalog, independent of what is installed', () => {
    expect(SECTION_DOCUMENT_COUNTS).toEqual(deriveSectionDocumentCounts(BASE_MODULE_CATALOG));
    const modules = BASE_MODULE_CATALOG.modules;
    // Current recommendations only: a replaced edition stays in the catalog but is not counted.
    const recommendations = modules.filter((module) =>
      module.tags.includes('individual-recommendation'),
    );
    const replaced = recommendations.filter((module) =>
      module.documents.every((document) => document.status === 'superseded'),
    );
    expect(SECTION_DOCUMENT_COUNTS.guidelines).toBe(recommendations.length - replaced.length);
    // One ЕСКЛП document per МНН: the instruction packs of the same drugs do not add to it.
    expect(SECTION_DOCUMENT_COUNTS.medications).toBe(
      modules
        .filter((module) => module.kind === 'medication' && module.collection === 'esklp')
        .reduce((total, module) => total + module.documents.length, 0),
    );
    for (const count of Object.values(SECTION_DOCUMENT_COUNTS)) expect(count).toBeGreaterThan(0);
  });
});
