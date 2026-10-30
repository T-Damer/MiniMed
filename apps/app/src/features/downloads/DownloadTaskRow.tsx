import { type JSX, Match, Show, Switch } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { DownloadProgressMark } from '@/components/DownloadProgressMark';
import {
  type DownloadKind,
  type DownloadPhase,
  type DownloadTask,
  downloadTaskFraction,
  isDownloadActive,
} from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';
import { formatCount } from '@/i18n/format-count';
import { formatByteSize } from '@/i18n/format-number';

const KIND_LABELS: Readonly<Record<DownloadKind, string>> = {
  core: 'Основная база',
  module: 'Набор документов',
  images: 'Изображения',
  ecg: 'ЭКГ',
  skin: 'Кожа по фото',
  ocr: 'Распознавание текста',
  speech: 'Распознавание речи',
  model: 'Локальная модель',
  document: 'Файл',
  app: 'Обновление приложения',
};

const PHASE_LABELS: Readonly<Record<DownloadPhase, string>> = {
  queued: 'В очереди',
  downloading: 'Скачивается',
  retrying: 'Ждёт повтора',
  verifying: 'Проверяем данные',
  installing: 'Сохраняем и подключаем',
  completed: 'Готово',
  failed: 'Ошибка',
  cancelling: 'Останавливаем',
  cancelled: 'Отменено',
  interrupted: 'Прервано перезапуском',
  paused: 'На паузе',
};

const RUNNING_PHASES = new Set<DownloadPhase>(['downloading', 'verifying', 'installing']);

/** The same size format as every other label of the app («1,4 МБ из 1,1 ГБ»). */
export function formatDownloadBytes(value: number): string {
  return formatByteSize(value);
}

function transferText(task: DownloadTask): string | undefined {
  if (task.state === 'downloading') {
    const transferred = task.totalBytes
      ? `${formatDownloadBytes(task.downloadedBytes)} из ${formatDownloadBytes(task.totalBytes)}`
      : formatDownloadBytes(task.downloadedBytes);
    return task.totalFiles !== null
      ? `${transferred} · файлы ${formatCount(task.completedFiles ?? 0)} из ${formatCount(task.totalFiles)}`
      : transferred;
  }
  return task.totalBytes ? formatDownloadBytes(task.totalBytes) : undefined;
}

function hint(task: DownloadTask): string | undefined {
  if (task.state === 'queued')
    return 'Начнётся, когда освободится одна из трёх передач и будет сеть.';
  if (task.state === 'retrying') return 'Повтор запустится автоматически.';
  if (task.state === 'installing') return 'Этот этап нельзя прервать.';
  if (task.state === 'paused') return 'Скачанная часть сохранена.';
  if (task.state === 'interrupted') return 'Продолжить можно после сверки с текущим каталогом.';
  return undefined;
}

function settledGlyph(state: DownloadPhase): AppGlyphName {
  if (state === 'completed') return 'check';
  if (state === 'paused') return 'pause';
  if (state === 'interrupted') return 'arrow-counter-clockwise';
  return 'close';
}

/** One queue entry: status mark, title, phase and size, and its own cancel/retry actions. */
export function DownloadTaskRow(props: {
  readonly task: DownloadTask;
  readonly onCancel: (task: DownloadTask) => void;
  readonly onRetry: (task: DownloadTask) => void;
}): JSX.Element {
  const fraction = () => downloadTaskFraction(props.task);
  const running = () => RUNNING_PHASES.has(props.task.state);
  // Re-read on every state change of the row: «Скачать сейчас» for a waiting module download.
  const canRunNow = () =>
    isDownloadActive(props.task) && getDownloadQueue().canPrioritize(props.task.id);
  const waiting = () =>
    props.task.state === 'queued' ||
    props.task.state === 'retrying' ||
    props.task.state === 'cancelling';
  const meta = () =>
    [KIND_LABELS[props.task.kind], PHASE_LABELS[props.task.state], transferText(props.task)]
      .filter(Boolean)
      .join(' · ');
  return (
    <li
      class="download-task"
      classList={{
        'download-task--failed': props.task.state === 'failed',
        'download-task--settled':
          props.task.state === 'completed' || props.task.state === 'cancelled',
      }}
      data-download-id={props.task.id}
      data-download-state={props.task.state}
    >
      <span class="download-task__mark">
        <Switch
          fallback={
            <span
              class="download-task__settled"
              classList={{ 'download-task__settled--failed': props.task.state === 'failed' }}
              aria-hidden="true"
            >
              <AppGlyph name={settledGlyph(props.task.state)} class="download-task__glyph" />
            </span>
          }
        >
          <Match when={running()}>
            <DownloadProgressMark state="running" progress={fraction()} />
          </Match>
          <Match when={waiting()}>
            <DownloadProgressMark state="queued" progress={null} />
          </Match>
        </Switch>
      </span>
      <div class="download-task__body">
        <div class="download-task__heading">
          <strong class="download-task__title">{props.task.title}</strong>
          <Show when={running() && fraction() !== null}>
            <span class="download-task__percent">{Math.floor((fraction() ?? 0) * 100)}%</span>
          </Show>
        </div>
        <Show when={running()}>
          <div
            class="download-task__bar"
            role="progressbar"
            aria-label={props.task.title}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={fraction() === null ? undefined : Math.floor((fraction() ?? 0) * 100)}
          >
            <span
              class="download-task__bar-fill"
              classList={{ 'download-task__bar-fill--indeterminate': fraction() === null }}
              style={{ width: `${Math.floor((fraction() ?? 0.3) * 100)}%` }}
            />
          </div>
        </Show>
        <p class="download-task__meta" role="status">
          {meta()}
        </p>
        <Show when={props.task.errorMessage ?? hint(props.task)}>
          {(text) => (
            <p
              class="download-task__note"
              classList={{ 'download-task__note--error': Boolean(props.task.errorMessage) }}
            >
              {text()}
            </p>
          )}
        </Show>
      </div>
      <div class="download-task__actions">
        <Show when={canRunNow()}>
          <Button
            class="download-task__action"
            variant="icon"
            aria-label="Скачать сейчас"
            title="Скачать сейчас"
            data-testid="download-task-now"
            icon={<AppGlyph name="lightning" class="download-task__glyph" />}
            onClick={() => getDownloadQueue().prioritize([props.task.id])}
          />
        </Show>
        <Show when={props.task.canRetry}>
          <Button
            class="download-task__action"
            variant="icon"
            aria-label="Повторить"
            title="Повторить"
            icon={<AppGlyph name="arrow-counter-clockwise" class="download-task__glyph" />}
            onClick={() => props.onRetry(props.task)}
          />
        </Show>
        <Show when={props.task.canCancel}>
          <Button
            class="download-task__action"
            variant="icon"
            aria-label="Отменить"
            title="Отменить"
            icon={<AppGlyph name="close" class="download-task__glyph" />}
            onClick={() => props.onCancel(props.task)}
          />
        </Show>
      </div>
    </li>
  );
}
