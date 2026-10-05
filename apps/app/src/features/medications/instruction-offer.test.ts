import { describe, expect, it } from 'vitest';

import { instructionModuleOffer, instructionOfferLabel } from './instruction-offer';

const ARTIFACT = {
  id: 'a',
  kind: 'index',
  required: true,
  url: 'https://example.test/a.db.zst',
  sha256: `sha256:${'a'.repeat(64)}`,
  sizeBytes: 24 * 1024 * 1024,
  compression: 'zstd',
  sourceSetDigest: `sha256:${'b'.repeat(64)}`,
} as const;

function catalogModule(id: string, title: string, downloadBytes: number | null = 24 * 1024 * 1024) {
  return {
    id,
    title,
    sizes: {
      downloadBytes,
      installedBytes: null,
      sourceAssetsDownloadBytes: null,
      precision: 'exact' as const,
    },
    releaseState: 'preview' as const,
    artifacts: [ARTIFACT],
    sourceSetDigest: ARTIFACT.sourceSetDigest,
  };
}

const MODULES = [
  catalogModule(
    'minimed.medications.instructions.nervous-system.ru',
    'Инструкции ГРЛС — Нервная система',
  ),
  catalogModule('minimed.medications.instructions.blood.ru', 'Инструкции ГРЛС — Кровь', null),
];

describe('instructionModuleOffer', () => {
  const base = {
    catalogModules: MODULES,
    installedModuleIds: new Set<string>(),
    isReleased: () => true,
  };

  it('offers the instruction module of the substance group', () => {
    const offer = instructionModuleOffer({
      ...base,
      substanceModuleId: 'minimed.medications.nervous-system.ru',
    });
    expect(offer).toEqual({
      moduleId: 'minimed.medications.instructions.nervous-system.ru',
      groupTitle: 'Нервная система',
      downloadBytes: 24 * 1024 * 1024,
    });
    expect(offer && instructionOfferLabel(offer)).toBe(
      'Скачать инструкции группы «Нервная система» · 24 МБ',
    );
  });

  it('names no size when the catalog has none', () => {
    const offer = instructionModuleOffer({
      ...base,
      substanceModuleId: 'minimed.medications.blood.ru',
    });
    expect(offer && instructionOfferLabel(offer)).toBe('Скачать инструкции группы «Кровь»');
  });

  it('offers nothing once the group is installed, when it is not released, or unlisted', () => {
    expect(
      instructionModuleOffer({
        ...base,
        substanceModuleId: 'minimed.medications.nervous-system.ru',
        installedModuleIds: new Set(['minimed.medications.instructions.nervous-system.ru']),
      }),
    ).toBeNull();
    expect(
      instructionModuleOffer({
        ...base,
        substanceModuleId: 'minimed.medications.nervous-system.ru',
        isReleased: () => false,
      }),
    ).toBeNull();
    expect(
      instructionModuleOffer({
        ...base,
        substanceModuleId: 'minimed.medications.dermatological.ru',
      }),
    ).toBeNull();
    expect(instructionModuleOffer({ ...base, substanceModuleId: null })).toBeNull();
    expect(
      instructionModuleOffer({ ...base, substanceModuleId: 'minimed.medications.ru' }),
    ).toBeNull();
  });
});
