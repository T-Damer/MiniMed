import type { MedicalStore } from '@localmed/storage';
import { describe, expect, it } from 'vitest';

import { builtInCompanionMounts } from '@/composition/create-browser-core';

function store(): MedicalStore {
  return {} as MedicalStore;
}

describe('builtInCompanionMounts', () => {
  it('uses the packaged regulatory database when no downloaded replacement exists', () => {
    const mounts = builtInCompanionMounts(
      {
        medicationsStore: store(),
        regulatoryStore: store(),
        referenceStore: store(),
      },
      new Set(),
    );

    expect(mounts.map((mount) => mount.moduleId)).toEqual([
      'minimed.medications.ru',
      'minimed.regulatory.pediatrics.ru',
      'minimed.reference.ru',
    ]);
  });

  it('does not mount the packaged regulatory copy beside an installed replacement', () => {
    const mounts = builtInCompanionMounts(
      {
        medicationsStore: store(),
        regulatoryStore: store(),
        referenceStore: store(),
      },
      new Set(['minimed.regulatory.pediatrics.ru']),
    );

    expect(mounts.map((mount) => mount.moduleId)).toEqual([
      'minimed.medications.ru',
      'minimed.reference.ru',
    ]);
  });
});
