import { describe, expect, it } from 'vitest';
import rawShell from '@/features/modules/catalog.shell.json';
import { BASE_MODULE_CATALOG } from '@/features/modules/module-catalog';
import { BUNDLED_CORE_MODULE, TOOL_CATALOG } from '@/features/modules/module-catalog-shell';
import { deriveModuleCatalogShell } from '@/features/modules/module-catalog-shell-source';

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
});
