import { describe, expect, it } from 'vitest';

import {
  INSTALL_GUIDE_STEPS,
  type InstallGuideKind,
  installGuideKind,
  installGuideNote,
  installWarningTitle,
  installWarningVisible,
  pairHere,
} from '@/features/diary/diary-install';

describe('install guide', () => {
  it('picks the miniature from the browser', () => {
    expect(installGuideKind({ messenger: true, platform: 'ios', ipad: false })).toBe('messenger');
    expect(installGuideKind({ messenger: false, platform: 'ios', ipad: false })).toBe('iphone');
    expect(installGuideKind({ messenger: false, platform: 'ios', ipad: true })).toBe('ipad');
    expect(installGuideKind({ messenger: false, platform: 'android', ipad: false })).toBe(
      'android',
    );
    expect(installGuideKind({ messenger: false, platform: 'other', ipad: false })).toBe('desktop');
  });

  it('warns until installed, and always inside a messenger', () => {
    expect(installWarningVisible({ messenger: false, advice: 'installed' })).toBe(false);
    expect(installWarningVisible({ messenger: false, advice: 'none' })).toBe(false);
    expect(installWarningVisible({ messenger: false, advice: 'prompt' })).toBe(true);
    expect(installWarningVisible({ messenger: false, advice: 'ios' })).toBe(true);
    expect(installWarningVisible({ messenger: false, advice: 'manual' })).toBe(true);
    expect(installWarningVisible({ messenger: true, advice: 'none' })).toBe(true);
  });

  it('titles the warning by what the patient must do', () => {
    expect(installWarningTitle(false)).toBe('Добавьте дневник на экран «Домой»');
    expect(installWarningTitle(true)).toBe('Откройте дневник в браузере');
  });

  it('keeps every step to one short line', () => {
    for (const steps of Object.values(INSTALL_GUIDE_STEPS)) {
      expect(steps.length).toBeGreaterThanOrEqual(3);
      for (const step of steps) expect(step.length).toBeLessThanOrEqual(48);
    }
  });

  it('mentions the separate iOS storage only when entries exist', () => {
    const kinds: readonly InstallGuideKind[] = ['iphone', 'ipad'];
    for (const kind of kinds) {
      expect(installGuideNote(kind, 0)).toBeNull();
      expect(installGuideNote(kind, 3)).toContain('отдельно');
    }
    expect(installGuideNote('iphone', 1)).toContain('iPhone');
    expect(installGuideNote('ipad', 1)).toContain('iPad');
    expect(installGuideNote('android', 5)).toBeNull();
    expect(installGuideNote('messenger', 5)).toBeNull();
    expect(installGuideNote('desktop', 5)).toBeNull();
  });

  it('keeps a connected note apart: the doctor holds the records', () => {
    expect(installGuideNote('iphone', 2, true)).toContain('новый код');
    expect(installGuideNote('iphone', 2, false)).toContain('Вернуть записи из копии');
  });

  it('pairs a connected diary where it will stay: never in iPhone Safari or a messenger', () => {
    expect(pairHere({ platform: 'ios', standalone: false, messenger: false })).toBe(false);
    expect(pairHere({ platform: 'ios', standalone: true, messenger: false })).toBe(true);
    expect(pairHere({ platform: 'android', standalone: false, messenger: false })).toBe(true);
    expect(pairHere({ platform: 'other', standalone: false, messenger: false })).toBe(true);
    expect(pairHere({ platform: 'android', standalone: false, messenger: true })).toBe(false);
  });
});
