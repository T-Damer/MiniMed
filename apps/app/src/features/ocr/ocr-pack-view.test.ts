import { describe, expect, it } from 'vitest';

import type { DownloadPhase, DownloadTask } from '@/features/downloads/download-queue';

import { ocrPackView } from './ocr-pack-view';

function task(state: DownloadPhase, patch: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: 'ocr:language-pack',
    kind: 'ocr',
    title: 'Распознавание текста (OCR)',
    state,
    downloadedBytes: 0,
    totalBytes: 19_557_397,
    completedFiles: null,
    totalFiles: null,
    attempt: 0,
    retryAt: null,
    errorMessage: null,
    canCancel: true,
    canRetry: false,
    updatedAt: 0,
    ...patch,
  };
}

describe('OCR language pack view', () => {
  it('offers the download with its size when nothing is on the device', () => {
    expect(ocrPackView({ installed: false, task: undefined })).toEqual({
      kind: 'missing',
      fraction: undefined,
      label: 'Не скачано · 19,6 МБ',
      busy: false,
      cancellable: false,
    });
  });

  it('is ready once installed, whatever the last task did', () => {
    expect(ocrPackView({ installed: true, task: task('completed') }).kind).toBe('ready');
    expect(ocrPackView({ installed: true, task: undefined }).busy).toBe(false);
  });

  it('shows the share of bytes while downloading and never reaches 100% before the commit', () => {
    const half = ocrPackView({
      installed: false,
      task: task('downloading', { downloadedBytes: 9_778_699 }),
    });
    expect(half).toMatchObject({ kind: 'downloading', busy: true, cancellable: true });
    expect(half.label).toBe('Скачивается · 50%');
    const all = ocrPackView({
      installed: false,
      task: task('downloading', { downloadedBytes: 19_557_397 }),
    });
    expect(all.label).toBe('Скачивается · 99%');
  });

  it('names verification and the final save as their own, indeterminate steps', () => {
    expect(ocrPackView({ installed: false, task: task('verifying') })).toMatchObject({
      kind: 'verifying',
      fraction: null,
      busy: true,
    });
    const installing = ocrPackView({
      installed: false,
      task: task('installing', { canCancel: false }),
    });
    expect(installing).toMatchObject({ kind: 'installing', busy: true, cancellable: false });
  });

  it('keeps a queued or retrying transfer busy so a second tap only joins it', () => {
    expect(ocrPackView({ installed: false, task: task('queued') })).toMatchObject({
      kind: 'queued',
      busy: true,
    });
    expect(ocrPackView({ installed: false, task: task('retrying') })).toMatchObject({
      kind: 'downloading',
      busy: true,
    });
  });

  it('turns a failure into a retryable state and a cancel or finish into «not downloaded»', () => {
    expect(ocrPackView({ installed: false, task: task('failed') })).toMatchObject({
      kind: 'failed',
      busy: false,
    });
    expect(ocrPackView({ installed: false, task: task('interrupted') }).kind).toBe('failed');
    expect(ocrPackView({ installed: false, task: task('cancelled') }).kind).toBe('missing');
    expect(ocrPackView({ installed: false, task: task('completed') }).kind).toBe('missing');
  });
});
