import {
  ContentModuleCatalogEntrySchema,
  ContentModuleCatalogSchema,
  TerminologySearchProjectionSchema,
} from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import rawTerminology from './catalog.terminology.json';

const terminology = ContentModuleCatalogEntrySchema.array().parse(rawTerminology);

import { MODULE_CATALOG, withBundledTerminology } from './module-catalog';

describe('published terminology descriptors', () => {
  it('keeps downloads present when an older remote catalog lacks the extra packages', () => {
    const base = ContentModuleCatalogSchema.parse({
      ...MODULE_CATALOG,
      modules: MODULE_CATALOG.modules.filter((m) => !m.id.startsWith('minimed.terminology.')),
    });
    const merged = withBundledTerminology(base);
    for (const entry of terminology) {
      expect(merged.modules.find((m) => m.id === entry.id)).toEqual(entry);
    }
    expect(withBundledTerminology(merged)).toEqual(merged);
  });

  it('has exact gzip and decoded identities for every optional reference pack', () => {
    for (const entry of terminology) {
      expect(entry.required).toBe(false);
      expect(entry.kind).toBe('reference');
      expect(entry.documents.length).toBe(entry.previewDocumentCount);
      const artifact = entry.artifacts[0];
      expect(artifact?.compression).toBe('gzip');
      expect(artifact?.decodedSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(artifact?.sha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    }
  });

  it('validates Russian lexical identity separately from MeSH equivalence', () => {
    const metadata = {
      version: 1,
      edition: '2026.9.16',
      conceptId: `ruwikt.${'a'.repeat(24)}`,
      names: ['афазия'],
      relatedConceptIds: [],
      definitionLanguages: ['ru'],
      discovery: true,
      targetDocumentId: `medical.term.ruwikt.${'a'.repeat(24)}`,
    };
    expect(TerminologySearchProjectionSchema.safeParse(metadata).success).toBe(true);
    expect(
      TerminologySearchProjectionSchema.safeParse({ ...metadata, conceptId: 'ruwikt.invalid' })
        .success,
    ).toBe(false);
    expect(
      TerminologySearchProjectionSchema.safeParse({ ...metadata, conceptId: 'untrusted.namespace' })
        .success,
    ).toBe(false);
  });
});
