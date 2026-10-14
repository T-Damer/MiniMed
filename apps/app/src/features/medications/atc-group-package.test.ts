import type { ContentModuleCatalogEntry, ContentModuleDownloadTask } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  atcDownloadAllLabel,
  atcGroupActionLabel,
  atcGroupPackage,
  atcGroupRowMeta,
} from '@/features/medications/atc-group-package';
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

describe('atcGroupRowMeta', () => {
  const counts = '1 подгруппа · 1 вещество';

  it('shows no counts for a package that is not on the device', () => {
    // The group's other substances live in the missing package: a partial count would mislead.
    const missing = atcGroupPackage('b', state(['a']));
    expect(atcGroupRowMeta(missing, counts, false)).toBe('не скачано · 586 КБ');
    expect(atcGroupRowMeta(atcGroupPackage('c', state([])), counts, false)).toBe('не скачано');
  });

  it('shows the counts of an installed package', () => {
    expect(atcGroupRowMeta(atcGroupPackage('a', state(['a'])), counts, false)).toBe(counts);
    expect(atcGroupRowMeta(atcGroupPackage('a', state(['a'])), null, true)).toBe('Читаем базу…');
  });

  it('says what the queue is doing and nothing before the package list is known', () => {
    const queued = atcGroupPackage('a', state([], [task('a', 'queued')]));
    expect(atcGroupRowMeta(queued, counts, false)).toBe('в очереди');
    const running = atcGroupPackage('a', state([], [task('a', 'downloading', 400)]));
    expect(atcGroupRowMeta(running, counts, false)).toMatch(/^скачивается/u);
    expect(atcGroupRowMeta(atcGroupPackage('a', undefined), counts, false)).toBe('');
    expect(atcGroupRowMeta(atcGroupPackage('zzz', state([])), counts, false)).toBe('недоступно');
  });
});

describe('atcDownloadAllLabel', () => {
  it('is the one action of the tree, with the size of everything still missing', () => {
    const base = state([]);
    const withSize = { ...base, plan: { ...base.plan, bytes: 286 * 1024 * 1024 } };
    expect(atcDownloadAllLabel(withSize, false, false)).toBe('Скачать всё · 286 МБ');
    expect(atcDownloadAllLabel(withSize, false, true)).toBe('Повторить · 286 МБ');
    expect(atcDownloadAllLabel(base, false, false)).toBe('Скачать всё');
  });

  it('shows progress while downloading and nothing once everything is installed', () => {
    const base = state([]);
    const running = { ...base, progress: { ...base.progress, byteProgress: 0.4 } };
    expect(atcDownloadAllLabel(running, true, false)).toBe('Скачиваем · 40 %');
    const complete = { ...base, plan: { ...base.plan, complete: true } };
    expect(atcDownloadAllLabel(complete, false, false)).toBe('');
    expect(atcDownloadAllLabel(undefined, false, false)).toBe('');
  });
});
