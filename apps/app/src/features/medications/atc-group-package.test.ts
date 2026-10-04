import type { ContentModuleCatalogEntry, ContentModuleDownloadTask } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { atcGroupActionLabel, atcGroupPackage } from '@/features/medications/atc-group-package';
import type { DrugDownloadState } from '@/features/medications/use-drug-download';

function entry(id: string, downloadBytes: number | null): ContentModuleCatalogEntry {
  return {
    id,
    kind: 'medication',
    sizes: { downloadBytes, installedBytes: 0, precision: 'exact' },
  } as unknown as ContentModuleCatalogEntry;
}

function task(moduleId: string, state: ContentModuleDownloadTask['state'], done = 0) {
  return {
    id: `t-${moduleId}`,
    moduleId,
    version: '1',
    state,
    downloadedBytes: done,
    totalBytes: 1000,
    includeSourceAssets: false,
    runsInBackground: false,
    errorMessage: null,
  } satisfies ContentModuleDownloadTask;
}

function state(
  installed: readonly string[],
  tasks: readonly ContentModuleDownloadTask[] = [],
): DrugDownloadState {
  const modules = [entry('a', 9_800_000), entry('b', 600_000), entry('c', null)];
  const installedIds = new Set(installed);
  return {
    modules,
    plan: { pending: modules.filter((m) => !installedIds.has(m.id)), bytes: null, complete: false },
    totalBytes: null,
    progress: {
      publishedCount: 3,
      installedCount: installed.length,
      activeTaskCount: tasks.length,
      installedFraction: 0,
      byteProgress: null,
    },
    installedIds,
    tasks,
  };
}

describe('atcGroupPackage', () => {
  it('is unknown until the package list loads and unavailable for a group without a package', () => {
    expect(atcGroupPackage('a', undefined).status).toBe('unknown');
    expect(atcGroupPackage('zzz', state([])).status).toBe('unavailable');
  });

  it('tells an installed package from a missing one and carries the declared size', () => {
    expect(atcGroupPackage('a', state(['a'])).status).toBe('installed');
    const missing = atcGroupPackage('b', state(['a']));
    expect(missing).toMatchObject({ status: 'missing', bytes: 600_000 });
    expect(atcGroupActionLabel(missing, false)).toBe('Скачать · 586 КБ');
    expect(atcGroupActionLabel(missing, true)).toBe('Повторить · 586 КБ');
    expect(atcGroupActionLabel(atcGroupPackage('c', state([])), false)).toBe('Скачать');
  });

  it('follows the queue: waiting, then downloading with a percentage', () => {
    const queued = atcGroupPackage('a', state([], [task('a', 'queued')]));
    expect(queued.status).toBe('queued');
    expect(atcGroupActionLabel(queued, false)).toBe('В очереди');
    const running = atcGroupPackage('a', state([], [task('a', 'downloading', 400)]));
    expect(running.status).toBe('downloading');
    expect(atcGroupActionLabel(running, false)).toMatch(/^Скачиваем/u);
    expect(atcGroupPackage('a', state([], [task('a', 'failed')])).status).toBe('missing');
  });
});
