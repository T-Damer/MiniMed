import type { MedicalStore } from '@localmed/storage';
import { describe, expect, it } from 'vitest';

import {
  builtInCompanionMounts,
  hasSqliteHeader,
  shouldOpenPackagedWasmCompanion,
} from '@/composition/create-browser-core';

function store(): MedicalStore {
  return {} as MedicalStore;
}

describe('builtInCompanionMounts', () => {
  it('uses the packaged regulatory database when no downloaded replacement exists', () => {
    const mounts = builtInCompanionMounts(
      {
        mkbStore: store(),
        medicationsStore: store(),
        ambulatoryStore: store(),
        regulatoryStore: store(),
        referenceStore: store(),
      },
      new Set(),
    );

    expect(mounts.map((mount) => mount.moduleId)).toEqual([
      'minimed.mkb.ru',
      'minimed.medications.ru',
      'minimed.ambulatory.v1',
      'minimed.regulatory.pediatrics.ru',
      'minimed.reference.pediatrics.ru',
    ]);
  });

  it('does not mount the packaged regulatory copy beside an installed replacement', () => {
    const mounts = builtInCompanionMounts(
      {
        mkbStore: store(),
        medicationsStore: store(),
        ambulatoryStore: store(),
        regulatoryStore: store(),
        referenceStore: store(),
      },
      new Set(['minimed.regulatory.pediatrics.ru']),
    );

    expect(mounts.map((mount) => mount.moduleId)).toEqual([
      'minimed.mkb.ru',
      'minimed.medications.ru',
      'minimed.ambulatory.v1',
      'minimed.reference.pediatrics.ru',
    ]);
  });

  it('does not mount the packaged reference copy beside an installed replacement', () => {
    const mounts = builtInCompanionMounts(
      {
        mkbStore: store(),
        medicationsStore: store(),
        ambulatoryStore: store(),
        regulatoryStore: store(),
        referenceStore: store(),
      },
      new Set(['minimed.reference.pediatrics.ru']),
    );

    expect(mounts.map((mount) => mount.moduleId)).toEqual([
      'minimed.mkb.ru',
      'minimed.medications.ru',
      'minimed.ambulatory.v1',
      'minimed.regulatory.pediatrics.ru',
    ]);
  });
});

describe('hasSqliteHeader', () => {
  it('rejects an HTML fallback served for a missing database asset', () => {
    expect(hasSqliteHeader(new TextEncoder().encode('<!doctype html>'))).toBe(false);
  });

  it('accepts a SQLite database header', () => {
    expect(hasSqliteHeader(new TextEncoder().encode('SQLite format 3\u0000'))).toBe(true);
  });
});

describe('shouldOpenPackagedWasmCompanion', () => {
  it('refuses local-dev packs that cannot fit in sqlite-wasm memory', () => {
    expect(shouldOpenPackagedWasmCompanion('mkb.db')).toBe(false);
    expect(shouldOpenPackagedWasmCompanion('medications.db')).toBe(false);
    expect(shouldOpenPackagedWasmCompanion('ambulatory.db')).toBe(false);
  });

  it('allows small packaged companions below the WASM size cap', () => {
    expect(shouldOpenPackagedWasmCompanion('regulatory.db', 1_600_000)).toBe(true);
    expect(shouldOpenPackagedWasmCompanion('reference.db', 540_000)).toBe(true);
  });

  it('refuses an oversized companion even when it is not on the unsafe name list', () => {
    expect(shouldOpenPackagedWasmCompanion('regulatory.db', 40 * 1024 * 1024)).toBe(false);
  });
});
