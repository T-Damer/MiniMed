import type {
  ContentModuleCatalogEntry,
  ContentModuleDownloadTask,
  InstalledContentModule,
} from '@localmed/contracts';
import { For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import {
  catalogModuleHidesInstallAction,
  catalogModuleHidesRemoveAction,
  isPreinstalledCatalogModule,
  type PreinstalledCatalogModuleOptions,
} from '@/features/modules/local-packaged-modules';
import { ModuleTaskStatus } from '@/features/modules/ModuleTaskStatus';
import {
  contentModuleTaskProgress,
  formatModuleBytes,
  MODULE_RELEASE_LABELS,
  MODULE_TASK_LABELS,
  moduleDocumentCountFact,
} from '@/features/modules/module-display';

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
  readonly preinstallOptions?: PreinstalledCatalogModuleOptions;
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
  const installedLabel = (): boolean =>
    Boolean(props.installed || isPreinstalledCatalogModule(props.module, props.preinstallOptions));
  const sizeLabel = (): string =>
    props.installed
      ? formatModuleBytes(props.installed.installedSizeBytes)
      : formatModuleBytes(props.module.sizes.downloadBytes);

  return (
    <article
      class="module-card paper-card"
      classList={{ 'module-card--installed': installedLabel() }}
    >
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
      <div class="module-card__topline">
        <span
          class={`module-state ${
            installedLabel()
              ? 'module-state--installed'
              : `module-state--${props.module.releaseState}`
          }`}
        >
          {installedLabel() ? 'Установлено' : MODULE_RELEASE_LABELS[props.module.releaseState]}
        </span>
        <small class="module-card__version">{props.module.version}</small>
      </div>
      <h3 class="module-card__title">{props.module.title}</h3>
      <p class="module-card__description">{props.module.description}</p>
      <div class="module-card__facts">
        <span class="module-card__fact">
          {props.module.toolCount
            ? `${props.module.toolCount} инструмент${props.module.toolCount === 1 ? '' : 'а'}`
            : moduleDocumentCountFact(props.module)}
        </span>
        <span class="module-card__fact">{sizeLabel()}</span>
      </div>
      <div class="module-card__status">
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
      </div>

      <Show when={!props.module.required}>
        <div
          class="module-card-actions module-card-actions--reserved"
          classList={{ 'module-card-actions--installed': installedLabel() }}
        >
          <Show
            when={installedLabel()}
            fallback={
              <Show
                when={
                  !working() &&
                  !catalogModuleHidesInstallAction(props.module, props.preinstallOptions)
                }
              >
                <button
                  type="button"
                  class="module-card-actions__primary"
                  disabled={props.module.releaseState !== 'published'}
                  onClick={props.onInstall}
                >
                  <AppGlyph name="download" class="module-card-actions__icon" />
                  {props.module.releaseState === 'published' ? 'Скачать' : 'Пока недоступно'}
                </button>
              </Show>
            }
          >
            <Show
              when={
                updateAvailable() &&
                !catalogModuleHidesInstallAction(props.module, props.preinstallOptions)
              }
            >
              <button
                type="button"
                class="module-card-actions__primary"
                disabled={working()}
                onClick={props.onInstall}
              >
                <AppGlyph name="refresh" class="module-card-actions__icon" />
                Обновить
              </button>
            </Show>
            <Show when={!catalogModuleHidesRemoveAction(props.module, props.preinstallOptions)}>
              <button
                type="button"
                class="module-remove-button module-card-actions__remove"
                aria-label={`Удалить «${props.module.title}»`}
                title="Удалить"
                onClick={props.onRemove}
              >
                <AppGlyph name="trash" class="module-card-actions__icon" />
              </button>
            </Show>
          </Show>
        </div>
      </Show>

      <Show when={(props.installed?.previousVersions.length ?? 0) > 0}>
        <div class="module-card__versions">
          <span class="module-card__versions-label">Старые версии</span>
          <For each={props.installed?.previousVersions ?? []}>
            {(version) => (
              <button
                type="button"
                class="module-card__version-button"
                onClick={() => props.onActivateVersion(version)}
              >
                Версия {version}
              </button>
            )}
          </For>
        </div>
      </Show>
    </article>
  );
}
