import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  coreServesInstalledSet,
  type InstalledModuleVersion,
  installedDataVersion,
  publishCoreDataVersion,
  readInstalledDataVersion,
} from '@/state/search-data-version';

function module(
  moduleId: string,
  version: string,
  overrides: Partial<InstalledModuleVersion> = {},
): InstalledModuleVersion {
  return {
    moduleId,
    version,
    enabled: true,
    state: 'installed',
    activeSourceSetDigest: null,
    ...overrides,
  };
}

const CORE = module('minimed.core.ru', '0.6.47', { activeSourceSetDigest: 'sha256:core' });

describe('installed data version', () => {
  it('is the same for the same installed set in any order', () => {
    const a = module('minimed.clinical.a', '1');
    const b = module('minimed.clinical.b', '2');
    expect(installedDataVersion([CORE, a, b])).toBe(installedDataVersion([b, CORE, a]));
  });

  it('moves with the core version', () => {
    const next = module('minimed.core.ru', '0.6.48', { activeSourceSetDigest: 'sha256:core' });
    expect(installedDataVersion([CORE])).not.toBe(installedDataVersion([next]));
  });

  it('moves when a module is installed, removed, updated, disabled or rebuilt', () => {
    const a = module('minimed.clinical.a', '1');
    const base = installedDataVersion([CORE, a]);
    expect(installedDataVersion([CORE])).not.toBe(base);
    expect(installedDataVersion([CORE, a, module('minimed.clinical.b', '1')])).not.toBe(base);
    expect(installedDataVersion([CORE, module('minimed.clinical.a', '2')])).not.toBe(base);
    expect(
      installedDataVersion([CORE, module('minimed.clinical.a', '1', { enabled: false })]),
    ).not.toBe(base);
    expect(
      installedDataVersion([
        CORE,
        module('minimed.clinical.a', '1', { activeSourceSetDigest: 'sha256:x' }),
      ]),
    ).not.toBe(base);
  });

  it('stays short however many modules are installed', () => {
    const modules = Array.from({ length: 800 }, (_, index) =>
      module(`minimed.clinical.m${index}`, '1'),
    );
    expect(installedDataVersion([CORE, ...modules]).length).toBeLessThan(80);
  });
});

describe('core serves the installed set', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubStorage(): void {
    const values = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        key: (index: number) => [...values.keys()][index] ?? null,
        get length() {
          return values.size;
        },
      },
    });
  }

  it('is true only for the installed set the published core was built from', () => {
    stubStorage();
    publishCoreDataVersion(readInstalledDataVersion());
    // A document missing from that core: building it again from the same set cannot find it.
    expect(coreServesInstalledSet()).toBe(true);
    // The core now searching was built from another set (an install it has not picked up yet).
    publishCoreDataVersion('core:0.6.47:sha256:core|modules:1.00000000000000');
    expect(coreServesInstalledSet()).toBe(false);
  });
});
