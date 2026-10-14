import type { ContentModuleDownloadTask } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import type { DownloadPhase, DownloadTask } from './download-queue';
import {
  isModuleDownloadBusy,
  type ModuleDownloadInput,
  moduleDownloadStatusLabel,
  moduleDownloadView,
} from './module-download-view';

const MODULE = 'minimed.grls.instructions.j';

function queueTask(
  state: DownloadPhase,
  downloadedBytes = 0,
  totalBytes: number | null = 100,
  id = `module:${MODULE}@1.0.0`,
): DownloadTask {
  return {
    id,
    kind: 'module',
    title: 'Инструкции ГРЛС',
    state,
    downloadedBytes,
    totalBytes,
    completedFiles: null,
    totalFiles: null,
    attempt: 0,
    retryAt: null,
    errorMessage: null,
    canCancel: true,
    canRetry: false,
    updatedAt: 0,
  };
}

function runtimeTask(
  state: ContentModuleDownloadTask['state'],
  downloadedBytes = 0,
  totalBytes: number | null = 100,
): ContentModuleDownloadTask {
  return {
    id: 'task-1',
    moduleId: MODULE,
    version: '1.0.0',
    state,
    downloadedBytes,
    totalBytes,
    errorMessage: null,
  } as unknown as ContentModuleDownloadTask;
}

function input(patch: Partial<ModuleDownloadInput> = {}): ModuleDownloadInput {
  return {
    moduleId: MODULE,
    installed: false,
    queueTasks: [],
    runtimeTasks: [],
    pendingModuleIds: new Set(),
    starting: false,
    ...patch,
  };
}

describe('module download view', () => {
  it('is idle with nothing in flight', () => {
    const view = moduleDownloadView(input());
    expect(view.phase).toBe('idle');
    expect(isModuleDownloadBusy(view)).toBe(false);
    expect(moduleDownloadStatusLabel(view)).toBe('');
  });

  it('shows an in-flight download from the shared queue before the runtime is loaded', () => {
    // A download that reached 30 % before the screen was left and reopened.
    const view = moduleDownloadView(input({ queueTasks: [queueTask('downloading', 30)] }));
    expect(view.phase).toBe('downloading');
    expect(view.percent).toBe(30);
    expect(moduleDownloadStatusLabel(view)).toBe('Скачиваем · 30 %');
    expect(isModuleDownloadBusy(view)).toBe(true);
  });

  it('prefers the runtime task once it is loaded', () => {
    const view = moduleDownloadView(
      input({
        queueTasks: [queueTask('downloading', 30)],
        runtimeTasks: [runtimeTask('downloading', 60)],
      }),
    );
    expect(view.percent).toBe(60);
  });

  it('reports a queued module as waiting, not as started', () => {
    expect(moduleDownloadView(input({ queueTasks: [queueTask('queued')] })).phase).toBe('queued');
    expect(moduleDownloadView(input({ runtimeTasks: [runtimeTask('queued')] })).phase).toBe(
      'queued',
    );
    expect(moduleDownloadView(input({ queueTasks: [queueTask('retrying')] })).phase).toBe('queued');
  });

  it('never claims a finished download is still queued', () => {
    for (const state of ['completed', 'cancelled'] as const) {
      expect(moduleDownloadView(input({ queueTasks: [queueTask(state)] })).phase).toBe('idle');
    }
    expect(moduleDownloadView(input({ runtimeTasks: [runtimeTask('completed')] })).phase).toBe(
      'idle',
    );
  });

  it('does not attribute another module of a shared group to this one', () => {
    const other = queueTask('downloading', 50, 100, 'module:minimed.grls.instructions.n@1.0.0');
    expect(moduleDownloadView(input({ queueTasks: [other] })).phase).toBe('idle');
    // A module whose id merely starts with this id is not this module either.
    const longer = queueTask('downloading', 50, 100, `module:${MODULE}2@1.0.0`);
    expect(moduleDownloadView(input({ queueTasks: [longer] })).phase).toBe('idle');
  });

  it('keeps the wait visible while a reload-interrupted download is resumed', () => {
    const view = moduleDownloadView(input({ queueTasks: [queueTask('interrupted', 30)] }));
    expect(view.phase).toBe('resuming');
    expect(moduleDownloadStatusLabel(view)).toBe('Продолжаем…');
  });

  it('resumes from a durable intent before the queue knows the task', () => {
    const view = moduleDownloadView(input({ pendingModuleIds: new Set([MODULE]) }));
    expect(view.phase).toBe('resuming');
  });

  it('says «подключаемся» for a start that has not received a byte', () => {
    expect(moduleDownloadView(input({ starting: true })).phase).toBe('connecting');
    expect(moduleDownloadView(input({ queueTasks: [queueTask('downloading', 0)] })).phase).toBe(
      'connecting',
    );
    expect(moduleDownloadStatusLabel(moduleDownloadView(input({ starting: true })))).toBe(
      'Подключаемся…',
    );
  });

  it('shows the checksum and commit phase after the last byte', () => {
    expect(moduleDownloadView(input({ queueTasks: [queueTask('downloading', 100)] })).phase).toBe(
      'downloading',
    );
    expect(
      moduleDownloadView(input({ runtimeTasks: [runtimeTask('downloading', 100)] })).phase,
    ).toBe('installing');
    expect(moduleDownloadView(input({ queueTasks: [queueTask('verifying', 100)] })).phase).toBe(
      'installing',
    );
  });

  it('never reaches 100 % before the install', () => {
    const view = moduleDownloadView(
      input({ runtimeTasks: [runtimeTask('downloading', 99.9, 100)] }),
    );
    expect(view.percent).toBe(99);
  });

  it('offers a retry for a failed record unless a new start is under way', () => {
    expect(moduleDownloadView(input({ queueTasks: [queueTask('failed')] })).phase).toBe('failed');
    expect(
      moduleDownloadView(input({ queueTasks: [queueTask('failed')], starting: true })).phase,
    ).toBe('connecting');
  });

  it('installed wins over every record', () => {
    const view = moduleDownloadView(
      input({ installed: true, queueTasks: [queueTask('downloading', 30)] }),
    );
    expect(view.phase).toBe('installed');
    expect(isModuleDownloadBusy(view)).toBe(false);
  });

  it('uses the newest version record of the module', () => {
    const older = queueTask('failed', 0, 100, `module:${MODULE}@0.9.0`);
    const newer = queueTask('downloading', 40, 100, `module:${MODULE}@1.0.0`);
    expect(moduleDownloadView(input({ queueTasks: [older, newer] })).percent).toBe(40);
  });
});
