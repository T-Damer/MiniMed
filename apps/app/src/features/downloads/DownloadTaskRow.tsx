import { type JSX, Match, Show, Switch } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { DownloadProgressMark } from '@/components/DownloadProgressMark';
import {
  type DownloadKind,
  type DownloadPhase,
  type DownloadTask,
  downloadTaskFraction,
} from '@/features/downloads/download-queue';

const KIND_LABELS: Readonly<Record<DownloadKind, string>> = {
  core: 'Ядро знаний',
  module: 'Набор документов',
  images: 'Изображения',
  ecg: 'ЭКГ',
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
};

const RUNNING_PHASES = new Set<DownloadPhase>(['downloading', 'verifying', 'installing']);

export function formatDownloadBytes(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} ГБ`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} МБ`;
  return `${Math.max(1, Math.round(value / 1_000))} КБ`;
}

function transferText(task: DownloadTask): string | undefined {
  if (task.state === 'downloading') {
    const transferred = task.totalBytes
      ? `${formatDownloadBytes(task.downloadedBytes)} из ${formatDownloadBytes(task.totalBytes)}`
      : formatDownloadBytes(task.downloadedBytes);
    return task.totalFiles !== null
      ? `${transferred} · файлы ${task.completedFiles ?? 0} из ${task.totalFiles}`
      : transferred;
  }
  return task.totalBytes ? formatDownloadBytes(task.totalBytes) : undefined;
}

function hint(task: DownloadTask): string | undefined {
  if (task.state === 'queued')
    return 'Начнётся, когда освободится одна из трёх передач и будет сеть.';
  if (task.state === 'retrying') return 'Повтор запустится автоматически.';
  if (task.state === 'installing') return 'Этот этап нельзя прервать.';
  if (task.state === 'interrupted') return 'Продолжить можно после сверки с текущим каталогом.';
  return undefined;
}

function settledGlyph(state: DownloadPhase): AppGlyphName {
  if (state === 'completed') return 'check';
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
