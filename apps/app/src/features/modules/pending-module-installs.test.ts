import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dequeuePendingModuleInstall,
  discardPendingModuleInstall,
  enqueuePendingModuleInstall,
  listPendingModuleInstalls,
} from '@/features/modules/pending-module-installs';

interface LocalStorageHarness {
  readonly store: Map<string, string>;
}

function installLocalStorageMock(): LocalStorageHarness {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  vi.stubGlobal('window', { localStorage });
  return { store };
}

describe('pending-module-installs', () => {
  let harness: LocalStorageHarness;

  beforeEach(() => {
    harness = installLocalStorageMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the durable queue entry after a failed or interrupted task', () => {
    enqueuePendingModuleInstall('clinical.100', '1.0.0', false);

    dequeuePendingModuleInstall('clinical.100', '1.0.0');

    expect(listPendingModuleInstalls()).toEqual([
      expect.objectContaining({ moduleId: 'clinical.100', version: '1.0.0' }),
    ]);
  });

  it('discards a cancelled or permanently failed install', () => {
    enqueuePendingModuleInstall('clinical.100', '1.0.0', false);

    discardPendingModuleInstall('clinical.100', '1.0.0');

    expect(listPendingModuleInstalls()).toEqual([]);
  });

  it('removes a pending install only after the exact version is active', () => {
    enqueuePendingModuleInstall('clinical.100', '1.0.0', false);
    harness.store.set(
      'localmed.installed-modules.v1',
      JSON.stringify({
        schemaVersion: 1,
        entries: [{ moduleId: 'clinical.100', active: { version: '1.0.0' } }],
      }),
    );

    dequeuePendingModuleInstall('clinical.100', '1.0.0');

    expect(listPendingModuleInstalls()).toEqual([]);
  });

  it('keeps a queued update when an older version is installed', () => {
    enqueuePendingModuleInstall('clinical.100', '1.1.0', false);
    harness.store.set(
      'localmed.installed-modules.v1',
      JSON.stringify({
        schemaVersion: 1,
        entries: [{ moduleId: 'clinical.100', active: { version: '1.0.0' } }],
      }),
    );

    dequeuePendingModuleInstall('clinical.100', '1.1.0');

    expect(listPendingModuleInstalls()).toHaveLength(1);
  });

  it('replaces duplicate queue entries for the same module version', () => {
    enqueuePendingModuleInstall('clinical.100', '1.0.0', false);
    enqueuePendingModuleInstall('clinical.100', '1.0.0', false);

    expect(listPendingModuleInstalls()).toHaveLength(1);
  });
});
