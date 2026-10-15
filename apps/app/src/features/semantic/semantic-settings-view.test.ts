import { describe, expect, it } from 'vitest';

import { semanticSettingsView } from './semantic-settings-view';

const base = { installed: false, removing: false, sizeLabel: '130 МБ' } as const;

describe('Settings → «Поиск по смыслу»', () => {
  it('shows the bundled model as part of the app, with no download, cancel or delete', () => {
    for (const installed of [true, false]) {
      expect(semanticSettingsView({ ...base, source: 'bundled', installed })).toEqual({
        status: 'Встроено в приложение',
        tone: 'ready',
        actions: { install: false, cancel: false, remove: false },
      });
    }
    // A leftover queue task or a removal in progress never brings the controls back.
    expect(
      semanticSettingsView({
        ...base,
        source: 'bundled',
        removing: true,
        task: { state: 'downloading', fraction: 0.4 },
      }).actions,
    ).toEqual({ install: false, cancel: false, remove: false });
  });

  it('offers the size and the download on the web until the model is installed', () => {
    const view = semanticSettingsView({ ...base, source: 'download' });
    expect(view.status).toBe('Не скачано · 130 МБ');
    expect(view.actions).toEqual({ install: true, cancel: false, remove: false });
  });

  it('shows progress and cancel while downloading, then delete once installed', () => {
    const downloading = semanticSettingsView({
      ...base,
      source: 'download',
      task: { state: 'downloading', fraction: 0.456 },
    });
    expect(downloading.status).toBe('Скачивается · 45%');
    expect(downloading.actions).toEqual({ install: false, cancel: true, remove: false });
    expect(
      semanticSettingsView({
        ...base,
        source: 'download',
        task: { state: 'verifying', fraction: 1 },
      }).status,
    ).toBe('Проверяем файлы…');
    expect(
      semanticSettingsView({ ...base, source: 'download', task: { state: 'queued', fraction: 0 } })
        .status,
    ).toBe('В очереди');
    const ready = semanticSettingsView({ ...base, source: 'download', installed: true });
    expect(ready).toEqual({
      status: 'Готово к работе',
      tone: 'ready',
      actions: { install: false, cancel: false, remove: true },
    });
    expect(
      semanticSettingsView({ ...base, source: 'download', installed: true, removing: true }),
    ).toMatchObject({
      status: 'Удаляем…',
      actions: { remove: false },
    });
  });

  it('offers nothing while the platform decision is being read', () => {
    expect(semanticSettingsView({ ...base, source: 'checking' }).actions).toEqual({
      install: false,
      cancel: false,
      remove: false,
    });
  });
});
