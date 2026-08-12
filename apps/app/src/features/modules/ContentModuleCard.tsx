import type {
  ContentModuleCatalogEntry,
  ContentModuleDownloadTask,
  InstalledContentModule,
} from '@localmed/contracts';
import { For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { ModuleTaskStatus } from '@/features/modules/ModuleTaskStatus';
import {
  contentModuleTaskProgress,
  formatModuleBytes,
  MODULE_RELEASE_LABELS,
  MODULE_TASK_LABELS,
} from '@/features/modules/module-display';
import { documentCountLabel } from '@/i18n/labels';

interface ContentModuleCardProps {
  readonly module: ContentModuleCatalogEntry;
  readonly installed?: InstalledContentModule | undefined;
  readonly task?: ContentModuleDownloadTask | undefined;
  readonly retryScheduled?: boolean | undefined;
  readonly fallbackError?: string | null | undefined;
  readonly connecting?: boolean | undefined;
  readonly onInspect: () => void;
  readonly onOpenError: (message: string) => void;
  readonly onInstall: () => void;
  readonly onOpenCore: () => void;
  readonly onRemove: () => void;
  readonly onActivateVersion: (version: string) => void;
}

export function ContentModuleCard(props: ContentModuleCardProps): JSX.Element {
  const progress = (): number | null => (props.task ? contentModuleTaskProgress(props.task) : null);
  const installError = (): string | null =>
    props.task?.state === 'failed' && !props.retryScheduled
      ? props.task.errorMessage || 'Не удалось скачать набор.'
      : props.fallbackError || null;
  const working = (): boolean =>
    Boolean(
      props.retryScheduled ||
        (props.task && !['completed', 'failed', 'cancelled'].includes(props.task.state)),
    );
  const updateAvailable = (): boolean =>
    Boolean(
      props.installed &&
        props.installed.version !== props.module.version &&
        props.module.releaseState === 'published',
    );

  return (
    <article class="module-card paper-card" classList={{ installed: Boolean(props.installed) }}>
      <button
        type="button"
        class="module-card-open-hit-area"
        aria-label={
          props.module.required
            ? 'Показать документы ядра'
            : `Показать документы набора «${props.module.title}»`
        }
        onClick={props.module.required ? props.onOpenCore : props.onInspect}
      />
      <div class="module-card-topline">
        <span
          class={`module-state ${
            props.installed ? 'state-installed' : `state-${props.module.releaseState}`
          }`}
        >
          {props.installed ? 'Установлено' : MODULE_RELEASE_LABELS[props.module.releaseState]}
        </span>
        <small class="module-card-version">{props.module.version}</small>
      </div>
      <h3>{props.module.title}</h3>
      <p>{props.module.description}</p>
      <div class="module-facts doctor-module-facts">
        <span>
          {props.module.previewDocumentCount || props.module.documents.length
            ? documentCountLabel(props.module.previewDocumentCount || props.module.documents.length)
            : 'Список документов уточняется'}
        </span>
        <Show
          when={props.installed}
          fallback={<span>{formatModuleBytes(props.module.sizes.downloadBytes)}</span>}
        >
          {(installed) => (
            <>
              <span>Версия {installed().version}</span>
              <span>На устройстве {formatModuleBytes(installed().installedSizeBytes)}</span>
            </>
          )}
        </Show>
      </div>
      <Show when={props.task || installError() || props.connecting}>
        <ModuleTaskStatus
          label={
            props.retryScheduled
              ? 'Повторим автоматически'
              : !props.task && props.connecting
                ? 'Подключаем к поиску…'
                : MODULE_TASK_LABELS[props.task?.state ?? 'failed']
          }
          progress={props.task ? progress() : null}
          errorMessage={installError()}
          onOpenError={() => props.onOpenError(installError() ?? 'Не удалось скачать набор.')}
        />
      </Show>

      <Show when={!props.module.required} fallback={null}>
        <Show
          when={!props.installed}
          fallback={
            <div class="module-card-actions">
              <Show when={updateAvailable()}>
                <button type="button" disabled={working()} onClick={props.onInstall}>
                  <AppGlyph name="refresh" />
                  Обновить
                </button>
              </Show>
              <button
                type="button"
                class="module-remove-button"
                aria-label={`Удалить «${props.module.title}»`}
                title="Удалить"
                onClick={props.onRemove}
              >
                <AppGlyph name="trash" />
              </button>
            </div>
          }
        >
          <Show when={!working()}>
            <button
              type="button"
              disabled={props.module.releaseState !== 'published'}
              onClick={props.onInstall}
            >
              <AppGlyph name="download" />
              {props.module.releaseState === 'published' ? 'Скачать' : 'Пока недоступно'}
            </button>
          </Show>
        </Show>
      </Show>

      <Show when={(props.installed?.previousVersions.length ?? 0) > 0}>
        <div class="module-version-history">
          <span>Старые версии</span>
          <For each={props.installed?.previousVersions ?? []}>
            {(version) => (
              <button type="button" onClick={() => props.onActivateVersion(version)}>
                Версия {version}
              </button>
            )}
          </For>
        </div>
      </Show>
    </article>
  );
}
