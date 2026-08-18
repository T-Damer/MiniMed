import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  catalogSelectionFromLocation,
  lawsRouteForModule,
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
