import type { ContentModuleCatalog } from '@localmed/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadQueue } from '@/features/downloads/download-queue';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';

import {
  dequeuePendingModuleInstall,
  discardPendingModuleInstall,
  enqueuePendingModuleInstall,
  listPendingModuleInstalls,
  recoverPendingModuleInstalls,
  retireSupersededModuleDownloads,
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
  it('retires obsolete failed downloads after an upgrade without touching current or active jobs', () => {
    const queue = new DownloadQueue();
    for (const [id, state] of [
      ['module:tools@1', 'failed'],
      ['module:tools@2', 'failed'],
      ['module:tools@3', 'downloading'],
      ['module:other@1', 'failed'],
    ] as const) {
      queue.observe({ id, kind: 'module', title: id }, { state }, {});
    }
    retireSupersededModuleDownloads(queue, 'tools', '2');
    expect(queue.get('module:tools@1')?.state).toBe('cancelled');
    expect(queue.get('module:tools@2')?.state).toBe('failed');
    expect(queue.get('module:tools@3')?.state).toBe('downloading');
    expect(queue.get('module:other@1')?.state).toBe('failed');
  });
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

describe('restoring queued downloads', () => {
  beforeEach(() => {
    installLocalStorageMock();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function catalogFixture(): ContentModuleCatalog {
    const published = MODULE_CATALOG.modules.find((module) => module.releaseState === 'published');
    const local = MODULE_CATALOG.modules.find((module) => module.id === 'minimed.medications.ru');
    if (!published || !local) throw new Error('Expected released and local-only catalog entries.');
    return {
      ...MODULE_CATALOG,
      modules: [{ ...local, artifacts: [], releaseState: 'preview' }, published],
    };
  }

  it('drops an unbuilt local preview without blocking a valid queued module', () => {
    const catalog = catalogFixture();
    for (const module of catalog.modules)
      enqueuePendingModuleInstall(module.id, module.version, false);
    const install = vi.fn();
    recoverPendingModuleInstalls({ listTasks: () => [], install }, catalog, new Set());
    expect(install).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledWith(catalog.modules[1]);
    expect(listPendingModuleInstalls().map((pending) => pending.moduleId)).toEqual([
      catalog.modules[1]?.id,
    ]);
  });

  it('a rejected restored job cannot abort restoration of subsequent jobs', () => {
    const fixture = catalogFixture();
    const released = fixture.modules[1];
    if (!released) throw new Error('Expected published fixture.');
    const modules = [released, { ...released, id: 'test.next-module' }];
    for (const module of modules) enqueuePendingModuleInstall(module.id, module.version, false);
    const install = vi.fn().mockImplementationOnce(() => {
      throw new Error('incompatible version');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    recoverPendingModuleInstalls(
      { listTasks: () => [], install },
      { ...fixture, modules },
      new Set(),
    );
    expect(install).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledOnce();
    expect(listPendingModuleInstalls().map((pending) => pending.moduleId)).toEqual([
      'test.next-module',
    ]);
  });
});
