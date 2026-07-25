import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dequeuePendingModuleInstall,
  enqueuePendingModuleInstall,
  listPendingModuleInstalls,
} from '@/features/modules/pending-module-installs';

function installLocalStorageMock(): void {
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
}

describe('pending-module-installs', () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('queues and removes pending installs by module version', () => {
    enqueuePendingModuleInstall('clinical.100', '1.0.0', false);
    enqueuePendingModuleInstall('clinical.101', '1.0.0', true);

    expect(listPendingModuleInstalls()).toHaveLength(2);

    dequeuePendingModuleInstall('clinical.100', '1.0.0');
    expect(listPendingModuleInstalls()).toEqual([
      expect.objectContaining({
        moduleId: 'clinical.101',
        version: '1.0.0',
        includeSourceAssets: true,
      }),
    ]);
  });

  it('replaces duplicate queue entries for the same module version', () => {
    enqueuePendingModuleInstall('clinical.100', '1.0.0', false);
    enqueuePendingModuleInstall('clinical.100', '1.0.0', false);

    expect(listPendingModuleInstalls()).toHaveLength(1);
  });
});
