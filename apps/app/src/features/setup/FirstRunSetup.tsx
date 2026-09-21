import type { ContentModuleCatalog } from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { OverlayDialog } from '@/components/OverlayDialog';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import { formatModuleBytes } from '@/features/modules/module-display';
import { getContentModuleRuntime } from '@/features/modules/module-runtime-service';
import { subscribeAppPreferences } from '@/state/app-preferences';
import { PackageDownloadRow } from './PackageDownloadRow';
import { downloadPercent, setupPackageGroups } from './setup-state';
import './setup.css';

export function FirstRunSetup(props: {
  readonly coreReady: boolean;
  readonly coreRequired: boolean;
  readonly coreDownloading: boolean;
  readonly coreError: string | undefined;
  readonly coreProgress:
    | {
        readonly loaded: number;
        readonly total: number;
        readonly phase?: 'downloading' | 'verifying' | 'installing';
      }
    | undefined;
  readonly onDownloadCore: () => void;
  readonly onContentChanged: () => Promise<void>;
  readonly onClose: () => void;
  readonly catalog?: ContentModuleCatalog;
}): JSX.Element {
  const runtime = getContentModuleRuntime(props.catalog ?? MODULE_CATALOG);
  const [revision, setRevision] = createSignal(0);
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set(['reference']));
  const refresh = () => setRevision((value) => value + 1);
  onCleanup(runtime.subscribe(refresh));
  onCleanup(subscribeAppPreferences(refresh));
  const groups = createMemo(() => setupPackageGroups(runtime.getCatalog().modules));
  const coreState = () => {
    if (props.coreReady) return 'Установлено';
    if (props.coreError) return 'Ошибка';
    if (props.coreProgress?.phase === 'verifying') return 'Проверяем';
    if (props.coreProgress?.phase === 'installing') return 'Устанавливаем';
    if (props.coreDownloading) {
      const percent = downloadPercent(props.coreProgress?.loaded ?? 0, props.coreProgress?.total);
      return percent === undefined ? 'Скачиваем…' : `${Math.floor(percent)}%`;
    }
    return props.coreRequired ? 'Обязательно' : 'Проверяем наличие…';
  };
  return (
    <OverlayDialog
      open
      title="Подготовьте MiniMed к работе"
      class="first-run-setup"
      headerClass="first-run-setup__header"
      bodyClass="first-run-setup__body"
      onClose={props.onClose}
    >
      <div class="first-run-setup__content">
        <p class="first-run-setup__intro">
          Скачайте ядро для поиска. Остальные пакеты добавляют материалы для ваших задач — выберите
          только нужные.
        </p>
        <ul class="package-list">
          <li class="package-row package-row--required" data-module-id="minimed.core.ru">
            <div class="package-row__copy">
              <strong class="package-row__title package-row__title--required">
                Ядро знаний{' '}
                <span class="package-row__asterisk" aria-hidden="true">
                  *
                </span>
              </strong>
              <p class="package-row__description">
                Основной каталог и локальный поиск. Полные дополнительные источники можно скачать
                отдельно.
              </p>
              <Show when={props.coreProgress && props.coreDownloading}>
                <p class="package-row__description">
                  {formatModuleBytes(props.coreProgress?.loaded ?? 0)}
                  {(props.coreProgress?.total ?? 0) > 0
                    ? ` из ${formatModuleBytes(props.coreProgress?.total ?? 0)}`
                    : ''}
                </p>
              </Show>
              <Show when={props.coreError}>
                {(error) => (
                  <p class="package-row__error" role="alert">
                    {error()}
                  </p>
                )}
              </Show>
            </div>
            <div class="package-row__status">
              <span class="package-row__state" role="status" aria-live="polite">
                {coreState()}
              </span>
              <Show
                when={
                  !props.coreReady &&
                  (props.coreDownloading || (!props.coreRequired && !props.coreError))
                }
              >
                <progress
                  class="package-row__progress"
                  max={100}
                  value={
                    props.coreProgress?.phase === 'downloading' ||
                    props.coreProgress?.phase === undefined
                      ? downloadPercent(props.coreProgress?.loaded ?? 0, props.coreProgress?.total)
                      : undefined
                  }
                  aria-label="Загрузка ядра знаний"
                />
              </Show>
              <Show
                when={
                  props.coreRequired &&
                  !props.coreDownloading &&
                  !props.coreReady &&
                  !props.coreError
                }
              >
                <button
                  class="package-row__button package-row__button--primary"
                  type="button"
                  onClick={props.onDownloadCore}
                >
                  Скачать ядро
                </button>
              </Show>
              <Show when={props.coreError}>
                <button
                  class="package-row__button"
                  type="button"
                  onClick={() => window.location.reload()}
                >
                  Повторить
                </button>
              </Show>
            </div>
          </li>
        </ul>
        <p class="first-run-setup__required-note">
          * Обязательно для поиска. Свои файлы и настройки доступны и без ядра.
        </p>
        <h3 class="first-run-setup__optional-title">Дополнительно — по выбору</h3>
        <For each={groups()}>
          {(group) => (
            <details
              class="package-group"
              open={expanded().has(group.id)}
              onToggle={(event) => {
                const next = new Set(expanded());
                if (event.currentTarget.open) next.add(group.id);
                else next.delete(group.id);
                setExpanded(next);
              }}
            >
              <summary class="package-group__summary">
                <span class="package-group__title">{group.title}</span>
                <span class="package-group__count">{group.modules.length}</span>
              </summary>
              <p class="package-group__description">{group.description}</p>
              <Show when={expanded().has(group.id)}>
                <ul class="package-list">
                  <For each={group.modules}>
                    {(module) => (
                      <PackageDownloadRow
                        module={module}
                        runtime={runtime}
                        revision={revision()}
                        onContentChanged={props.onContentChanged}
                      />
                    )}
                  </For>
                </ul>
              </Show>
            </details>
          )}
        </For>
        <p class="first-run-setup__footer-note">
          Экран можно закрыть в любой момент: начатые загрузки останутся в общей очереди. Позже
          скачивайте пакеты через меню поиска или карточки материалов.
        </p>
        <button
          class="first-run-setup__continue"
          type="button"
          onClick={() => window.history.back()}
        >
          {props.coreReady ? 'Перейти к работе' : 'Продолжить без ожидания'}
        </button>
      </div>
    </OverlayDialog>
  );
}
