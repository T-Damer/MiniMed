import { describe, expect, it } from 'vitest';

import {
  type CoreSessionSnapshot,
  searchCoreProgress,
  searchCoreStatus,
  searchCoreStatusDetail,
  searchCoreStatusLabel,
  searchCoreStatusNoteVisible,
} from '@/features/search/search-core-status';

const idle: CoreSessionSnapshot = {
  ready: false,
  error: undefined,
  waitingForOtherTab: false,
  downloadRequired: false,
  downloading: false,
  progress: undefined,
  slow: false,
};

describe('search core status', () => {
  it('disappears once the core is ready, whatever else the session still reports', () => {
    expect(searchCoreStatus({ ...idle, ready: true, error: 'x', downloading: true })).toBe(
      undefined,
    );
  });

  it('reports opening, errors and another tab with the boot-screen wording', () => {
    expect(searchCoreStatusLabel(searchCoreStatus(idle) ?? { kind: 'verifying' })).toBe(
      'Подготавливаем поиск…',
    );
    const error = searchCoreStatus({
      ...idle,
      error: 'Не удалось открыть ядро',
      downloading: true,
    });
    expect(error).toEqual({ kind: 'error', message: 'Не удалось открыть ядро' });
    expect(searchCoreStatusDetail(error ?? { kind: 'verifying' })).toBe('Не удалось открыть ядро');
    const otherTab = searchCoreStatus({ ...idle, waitingForOtherTab: true });
    expect(searchCoreStatusLabel(otherTab ?? { kind: 'verifying' })).toBe(
      'MiniMed открыт в другой вкладке',
    );
  });

  it('shows download progress as a whole percentage, then verification and installation', () => {
    const downloading = searchCoreStatus({
      ...idle,
      downloadRequired: true,
      downloading: true,
      progress: { loaded: 169_000_000, total: 403_000_000, phase: 'downloading' },
    });
    expect(downloading).toMatchObject({ kind: 'downloading' });
    if (!downloading) throw new Error('Expected a download status.');
    expect(searchCoreStatusLabel(downloading)).toBe('Загружаем базу… 41%');
    expect(searchCoreProgress(downloading)).toBeCloseTo(0.419, 3);
    expect(
      searchCoreStatus({
        ...idle,
        downloading: true,
        progress: { loaded: 1, total: 1, phase: 'verifying' },
      }),
    ).toEqual({ kind: 'verifying' });
    expect(
      searchCoreStatusLabel(
        searchCoreStatus({ ...idle, progress: { loaded: 1, total: 1, phase: 'installing' } }) ?? {
          kind: 'opening',
          slow: false,
        },
      ),
    ).toBe('Устанавливаем базу…');
  });

  it('has no percentage before the size is known', () => {
    const connecting = searchCoreStatus({ ...idle, downloadRequired: true, downloading: true });
    if (!connecting) throw new Error('Expected a download status.');
    expect(searchCoreStatusLabel(connecting)).toBe('Загружаем базу…');
    expect(searchCoreProgress(connecting)).toBeNull();
    expect(searchCoreStatusDetail(connecting)).toBe('Соединяемся с сервером…');
  });

  it('keeps a missing core that waits for consent distinct from a running download', () => {
    expect(searchCoreStatus({ ...idle, downloadRequired: true })).toEqual({
      kind: 'download-required',
    });
  });
});

describe('searchCoreStatusNoteVisible', () => {
  it('keeps a quick open to the placeholder and explains longer or non-opening states', () => {
    expect(searchCoreStatusNoteVisible({ kind: 'opening', slow: false }, false)).toBe(false);
    expect(searchCoreStatusNoteVisible({ kind: 'opening', slow: false }, true)).toBe(true);
    expect(searchCoreStatusNoteVisible({ kind: 'opening', slow: true }, false)).toBe(true);
    expect(searchCoreStatusNoteVisible({ kind: 'other-tab' }, false)).toBe(true);
    expect(searchCoreStatusNoteVisible({ kind: 'error', message: 'x' }, false)).toBe(true);
  });
});
