import type { ContentModuleDownloadTask } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  activeContentDownloadTasks,
  aggregateDownloadProgress,
  downloadNavPieBackground,
  downloadProgressFraction,
  hasActiveContentDownloads,
  latestVisibleDownloadTasks,
} from '@/features/modules/content-download-progress';

function task(
  overrides: Partial<ContentModuleDownloadTask> &
    Pick<ContentModuleDownloadTask, 'id' | 'moduleId' | 'state'>,
): ContentModuleDownloadTask {
  return {
    version: '1.0.0',
    downloadedBytes: 0,
    totalBytes: null,
    includeSourceAssets: false,
    runsInBackground: true,
    errorMessage: null,
    ...overrides,
  };
}

describe('latestVisibleDownloadTasks', () => {
  it('keeps the latest active or failed task per module version', () => {
    const visible = latestVisibleDownloadTasks([
      task({ id: 'old', moduleId: 'laws', state: 'downloading', downloadedBytes: 10 }),
      task({ id: 'done', moduleId: 'core', state: 'completed' }),
      task({ id: 'next', moduleId: 'laws', state: 'failed', errorMessage: 'offline' }),
    ]);
    expect(visible.map((item) => item.id)).toEqual(['next']);
  });

  it('drops cancelled tasks', () => {
    expect(
      latestVisibleDownloadTasks([task({ id: 'stop', moduleId: 'laws', state: 'cancelled' })]),
    ).toEqual([]);
  });
});

describe('hasActiveContentDownloads', () => {
  it('is true only while a pack is queued, transferring, or installing', () => {
    expect(
      hasActiveContentDownloads([task({ id: 'fail', moduleId: 'laws', state: 'failed' })]),
    ).toBe(false);
    expect(
      hasActiveContentDownloads([
        task({ id: 'fail', moduleId: 'laws', state: 'failed' }),
        task({ id: 'next', moduleId: 'core', state: 'downloading' }),
      ]),
    ).toBe(true);
    expect(
      activeContentDownloadTasks([
        task({ id: 'fail', moduleId: 'laws', state: 'failed' }),
        task({ id: 'next', moduleId: 'core', state: 'queued' }),
      ]).map((item) => item.id),
    ).toEqual(['next']);
  });
});

describe('aggregateDownloadProgress', () => {
  it('weights known totals across visible tasks', () => {
    expect(
      aggregateDownloadProgress([
        task({
          id: 'a',
          moduleId: 'a',
          state: 'downloading',
          downloadedBytes: 25,
          totalBytes: 100,
        }),
        task({
          id: 'b',
          moduleId: 'b',
          state: 'downloading',
          downloadedBytes: 50,
          totalBytes: 100,
        }),
      ]),
    ).toBe(0.375);
  });

  it('returns null when no task reports a total', () => {
    expect(
      aggregateDownloadProgress([task({ id: 'a', moduleId: 'a', state: 'queued' })]),
    ).toBeNull();
  });
});

describe('downloadProgressFraction', () => {
  it('falls back to an indeterminate slice when totals are unknown', () => {
    expect(downloadProgressFraction([task({ id: 'a', moduleId: 'a', state: 'downloading' })])).toBe(
      0.08,
    );
  });
});

describe('downloadNavPieBackground', () => {
  it('uses a danger fill when the batch needs attention', () => {
    expect(downloadNavPieBackground(0.5, true)).toContain('var(--theme-danger');
    expect(downloadNavPieBackground(0.5, false)).toContain('#e8c654');
  });
});
