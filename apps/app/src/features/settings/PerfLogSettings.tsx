import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Switch } from '@/components/Switch';
import { pluralRu } from '@/i18n/labels';
import { PERF_LOG_EVENT, perfLogOn, setPerfLogEnabled } from '@/state/perf-log';

/** «12 мин · 1 534 события». */
export function perfLogProgressText(entries: number, minutes: number): string {
  const rounded = Math.round(minutes);
  const word = pluralRu(entries, 'событие', 'события', 'событий');
  const time = rounded < 1 ? 'меньше минуты' : `${String(rounded)} мин`;
  return `${time} · ${entries.toLocaleString('ru-RU')} ${word}`;
}

/**
 * Settings → «Основные» → «Журнал производительности» (PERFLOG1), shown only on a device where the
 * owner turned the log on (`perfLogAvailableHere`): the switch, how much is recorded, «Поделиться
 * журналом» and the bin. The collector is only loaded there.
 */
export function PerfLogSettings(): JSX.Element {
  const [enabled, setEnabled] = createSignal(perfLogOn());
  const [progress, setProgress] = createSignal('');
  const [hasLog, setHasLog] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  const refresh = async (): Promise<void> => {
    setEnabled(perfLogOn());
    const collector = await import('@/state/perf-log-collector');
    const running = collector.perfLogProgress();
    if (running) {
      setProgress(perfLogProgressText(running.entries, running.minutes));
      setHasLog(running.entries > 0);
      return;
    }
    const sessions = await collector.readPerfSessions();
    const entries = sessions.reduce((sum, item) => sum + item.entries.length, 0);
    const minutes = sessions.reduce((sum, item) => sum + item.durationMs / 60_000, 0);
    setHasLog(entries > 0);
    setProgress(entries > 0 ? `Сохранено: ${perfLogProgressText(entries, minutes)}` : '');
  };

  onMount(() => {
    const update = (): void => {
      void refresh().catch((cause: unknown) => console.warn('Журнал не прочитан.', cause));
    };
    update();
    window.addEventListener(PERF_LOG_EVENT, update);
    // Only while the page is open and the log runs: one cheap read every 5 s.
    const timer = window.setInterval(() => {
      if (perfLogOn()) update();
    }, 5_000);
    onCleanup(() => {
      window.removeEventListener(PERF_LOG_EVENT, update);
      window.clearInterval(timer);
    });
  });

  const toggle = (next: boolean): void => {
    setEnabled(next);
    void setPerfLogEnabled(next).catch((cause: unknown) => {
      console.warn('Журнал производительности не переключился.', cause);
      setEnabled(perfLogOn());
    });
  };

  const share = async (): Promise<void> => {
    setBusy(true);
    try {
      const { sharePerfLog } = await import('@/state/perf-log-export');
      const result = await sharePerfLog();
      if (result.outcome === 'empty') toast('Журнал пока пуст.');
      else if (result.outcome === 'downloaded') toast('Журнал сохранён в загрузки.');
    } catch (cause) {
      console.warn('Журнал не отправлен.', cause);
      toast.error('Не удалось поделиться журналом.');
    } finally {
      setBusy(false);
    }
  };

  const clear = async (): Promise<void> => {
    const collector = await import('@/state/perf-log-collector');
    await collector.clearPerfSessions();
    await refresh();
    toast('Журнал очищен.');
  };

  return (
    <div class="settings-row perf-log-settings" data-testid="perf-log-settings">
      <div class="settings-row__text">
        <span class="settings-row__label settings-row__label--with-icon">
          <AppGlyph name="chart-line" class="settings-row__label-icon" aria-hidden="true" />
          Журнал производительности
        </span>
        <p class="settings-row__helper">
          Где приложение тормозит — без текстов и данных пациентов. Выключится сам через 2 суток.
        </p>
        <Show when={progress()}>
          <p
            class="settings-row__helper perf-log-settings__progress"
            data-testid="perf-log-progress"
          >
            {enabled() ? `Пишется: ${progress()}` : progress()}
          </p>
        </Show>
        <Show when={hasLog()}>
          <div class="perf-log-settings__actions">
            <Button
              class="settings-row__action perf-log-settings__share"
              variant="primary"
              disabled={busy()}
              onClick={() => void share()}
            >
              Поделиться журналом
            </Button>
            <Button
              class="perf-log-settings__clear"
              variant="icon"
              icon={<AppGlyph name="trash" class="perf-log-settings__clear-glyph" />}
              aria-label="Очистить журнал"
              disabled={busy()}
              onClick={() => void clear()}
            />
          </div>
        </Show>
      </div>
      <Switch
        class="perf-log-settings__switch"
        checked={enabled()}
        aria-label="Журнал производительности"
        onChange={toggle}
      />
    </div>
  );
}
