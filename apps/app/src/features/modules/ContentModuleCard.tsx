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
  installedModuleValidationLabel,
  MODULE_RELEASE_LABELS,
  MODULE_TASK_LABELS,
  primaryModuleDocumentId,
} from '@/features/modules/module-display';

interface ContentModuleCardProps {
  readonly module: ContentModuleCatalogEntry;
  readonly installed?: InstalledContentModule | undefined;
  readonly task?: ContentModuleDownloadTask | undefined;
  readonly retryScheduled?: boolean | undefined;
  readonly fallbackError?: string | null | undefined;
  readonly onInspect: () => void;
  readonly onOpenError: (message: string) => void;
  readonly onInstall: () => void;
  readonly onOpenCore: () => void;
  readonly onOpenDocument: () => void;
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
          {props.module.previewDocumentCount || props.module.documents.length || '—'} документов
        </span>
        <Show
          when={props.installed}
          fallback={<span>{formatModuleBytes(props.module.sizes.downloadBytes)}</span>}
        >
          {(installed) => (
            <>
              <Show when={installed().version !== props.module.version}>
                <span>На устройстве версия {installed().version}</span>
              </Show>
              <span>На устройстве {formatModuleBytes(installed().installedSizeBytes)}</span>
              <span>{installedModuleValidationLabel(installed())}</span>
            </>
          )}
        </Show>
      </div>
      <button type="button" class="module-details-button" onClick={props.onInspect}>
        <AppGlyph name="list" /> Что входит
      </button>

      <Show when={props.task || installError()}>
        <ModuleTaskStatus
          label={
            props.retryScheduled
              ? 'Повторим автоматически'
              : MODULE_TASK_LABELS[props.task?.state ?? 'failed']
          }
          progress={progress()}
          errorMessage={installError()}
          onOpenError={() => props.onOpenError(installError() ?? 'Не удалось скачать набор.')}
        />
      </Show>

      <Show
        when={!props.module.required}
        fallback={
          <button type="button" onClick={props.onOpenCore}>
            <AppGlyph name="book-open" /> Открыть документы ядра
          </button>
        }
      >
        <Show
          when={!props.installed}
          fallback={
            <div class="module-card-actions">
              <Show when={updateAvailable()}>
                <button type="button" disabled={working()} onClick={props.onInstall}>
                  Обновить
                </button>
              </Show>
              <Show when={primaryModuleDocumentId(props.module)}>
                <button type="button" onClick={props.onOpenDocument}>
                  <AppGlyph name="book-open" /> Открыть
                </button>
              </Show>
              <button type="button" class="module-remove-button" onClick={props.onRemove}>
                <AppGlyph name="trash" /> Удалить с устройства
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
              {props.module.releaseState === 'published' ? 'Скачать документы' : 'Пока недоступно'}
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
                Открыть {version}
              </button>
            )}
          </For>
        </div>
      </Show>
    </article>
  );
}
