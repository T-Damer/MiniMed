import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  catalogGroupHash,
  catalogSelectionFromLocation,
  lawsRouteForModule,
  moduleCatalogHash,
  normalizeLawsSpecialtySlug,
  regulatoryModuleForSpecialty,
} from '@/features/modules/module-catalog-routing';

const regulatoryModule = {
  id: 'minimed.regulatory.pediatrics.ru',
  kind: 'regulatory',
  specialties: ['pediatrics', 'health-administration'],
  documents: [],
} as unknown as ContentModuleCatalogEntry;

describe('module-catalog-routing', () => {
  it('parses laws specialty routes', () => {
    expect(catalogSelectionFromLocation('#/modules/documents/laws/pediatrics')).toEqual({
      kind: 'laws',
      specialty: 'pediatrics',
    });
    expect(catalogSelectionFromLocation('#/modules/documents/laws/paediatrics')).toEqual({
      kind: 'laws',
      specialty: 'pediatrics',
    });
  });

  it('normalizes british pediatrics spelling', () => {
    expect(normalizeLawsSpecialtySlug('paediatrics')).toBe('pediatrics');
  });

  it('maps regulatory modules to laws routes by specialty', () => {
    expect(lawsRouteForModule(regulatoryModule)).toBe('#/modules/documents/laws/pediatrics');
    expect(regulatoryModuleForSpecialty([regulatoryModule], 'paediatrics')?.id).toBe(
      'minimed.regulatory.pediatrics.ru',
    );
  });
});

describe('download destinations', () => {
  const entry = (kind: string, collection: string) =>
    ({ id: 'set', kind, collection, specialties: [] }) as unknown as ContentModuleCatalogEntry;

  it('opens a downloaded section where the catalog shows it', () => {
    expect(catalogGroupHash('medications')).toBe('#/modules/documents/medications');
    expect(catalogGroupHash('reference')).toBe('#/modules/documents/collection/reference');
    expect(catalogGroupHash('cardiology')).toBe('#/modules/documents/category/cardiology');
  });

  it('opens a downloaded set in its own group', () => {
    expect(moduleCatalogHash(entry('clinical', 'cardiology'))).toBe(
      '#/modules/documents/category/cardiology',
    );
    expect(moduleCatalogHash(entry('medication', 'medications'))).toBe(
      '#/modules/documents/medications',
    );
    expect(moduleCatalogHash(regulatoryModule)).toBe('#/modules/documents/laws/pediatrics');
    expect(moduleCatalogHash(entry('tool', 'tools'))).toBe('#/modules/documents/collection/tool');
  });
});
