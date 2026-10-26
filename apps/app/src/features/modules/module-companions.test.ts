import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { companionModuleIds, companionModulesToInstall } from './module-companions';

const entry = (id: string): ContentModuleCatalogEntry => ({ id }) as ContentModuleCatalogEntry;
const CARDIO = 'minimed.medications.cardiovascular.ru';
const CARDIO_TEXT = 'minimed.medications.instructions.cardiovascular.ru';
const EAEU = 'minimed.medications.instructions.eaeu-sister-register.ru';

describe('modules installed together', () => {
  it('a drug group brings its official instructions and the EAEU texts, nothing else does', () => {
    expect(companionModuleIds(CARDIO)).toEqual([CARDIO_TEXT, EAEU]);
    expect(companionModuleIds(CARDIO_TEXT)).toEqual([]);
    expect(companionModuleIds(EAEU)).toEqual([]);
    expect(companionModuleIds('minimed.clinical.cardiology.ru')).toEqual([]);
  });

  it('skips a companion that is installed, on its way, missing or unreleased', () => {
    const base = {
      moduleId: CARDIO,
      catalogModules: [entry(CARDIO), entry(CARDIO_TEXT)],
      installedModuleIds: new Set<string>(),
      tasks: [],
      isReleased: () => true,
    };
    expect(companionModulesToInstall(base).map((module) => module.id)).toEqual([CARDIO_TEXT]);
    expect(
      companionModulesToInstall({
        ...base,
        catalogModules: [entry(CARDIO), entry(CARDIO_TEXT), entry(EAEU)],
        installedModuleIds: new Set([EAEU]),
      }).map((module) => module.id),
    ).toEqual([CARDIO_TEXT]);
    expect(
      companionModulesToInstall({ ...base, installedModuleIds: new Set([CARDIO_TEXT]) }),
    ).toEqual([]);
    expect(
      companionModulesToInstall({
        ...base,
        tasks: [{ moduleId: CARDIO_TEXT, state: 'downloading' }],
      }),
    ).toEqual([]);
    expect(
      companionModulesToInstall({ ...base, tasks: [{ moduleId: CARDIO_TEXT, state: 'failed' }] }),
    ).toHaveLength(1);
    expect(companionModulesToInstall({ ...base, catalogModules: [entry(CARDIO)] })).toEqual([]);
    expect(companionModulesToInstall({ ...base, isReleased: () => false })).toEqual([]);
  });
});
