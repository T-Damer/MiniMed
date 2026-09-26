import type { ContentModuleCatalog } from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Disclosure } from '@/components/Disclosure';
import { OverlayDialog } from '@/components/OverlayDialog';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import { formatModuleBytes } from '@/features/modules/module-display';
import { getContentModuleRuntime } from '@/features/modules/module-runtime-service';
import { subscribeAppPreferences } from '@/state/app-preferences';
import { DownloadProgress } from './DownloadProgress';
import { FeatureTour } from './FeatureTour';
import { PackageDownloadRow } from './PackageDownloadRow';
import { downloadPercent, setupPackageGroups } from './setup-state';
import './feature-tour.css';
import './setup.css';

export function FirstRunSetup(props: {
  readonly coreReady: boolean;
  readonly coreRequired: boolean;
  readonly coreDownloading: boolean;
  /** A metered connection is holding the automatic core download for the user's decision. */
  readonly coreDeferred: boolean;
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
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const refresh = () => setRevision((value) => value + 1);
  onCleanup(runtime.subscribe(refresh));
  onCleanup(subscribeAppPreferences(refresh));
  const groups = createMemo(() => setupPackageGroups(runtime.getCatalog().modules));

  // Search needs the core, so the screen stays until it is installed. Only a failure or a
  // metered connection lets the user leave early for their own files and settings.
  const canLeaveEarly = () => !props.coreReady && (Boolean(props.coreError) || props.coreDeferred);
  const dismissible = () => props.coreReady || canLeaveEarly();
  const percent = () =>
    props.coreProgress?.phase === 'downloading' || props.coreProgress?.phase === undefined
      ? downloadPercent(props.coreProgress?.loaded ?? 0, props.coreProgress?.total)
      : undefined;
  const coreStatus = () => {
    if (props.coreReady) return 'Установлено. Поиск работает без интернета.';
    if (props.coreError) return 'Загрузка не удалась.';
    if (props.coreDeferred) return 'Ждёт вашего решения: похоже, это мобильная сеть.';
    if (props.coreProgress?.phase === 'verifying') return 'Проверяем контрольную сумму…';
    if (props.coreProgress?.phase === 'installing') return 'Устанавливаем…';
    if (props.coreDownloading) {
      const loaded = props.coreProgress?.loaded ?? 0;
      const total = props.coreProgress?.total ?? 0;
      if (loaded === 0) return 'Соединяемся с сервером…';
      return total > 0
        ? `Скачано ${formatModuleBytes(loaded)} из ${formatModuleBytes(total)}`
        : `Скачано ${formatModuleBytes(loaded)}`;
    }
    return 'Проверяем, установлено ли ядро…';
  };
  const footerLabel = () => {
    if (props.coreReady) return 'Начать работу';
    const value = percent();
    return value === undefined ? 'Готовим поиск…' : `Загружаем ядро · ${Math.floor(value)}%`;
  };

  return (
    <OverlayDialog
      open
      title="Добро пожаловать в MiniMed"
      class="first-run-setup"
      headerClass="first-run-setup__header"
      bodyClass="first-run-setup__body"
      tracksHistory={false}
      dismissible={dismissible()}
      onClose={props.onClose}
    >
      <div class="first-run-setup__scroll">
        <div class="first-run-setup__content">
          <section
            class="setup-core"
            classList={{
              'setup-core--ready': props.coreReady,
              'setup-core--error': Boolean(props.coreError),
            }}
            data-module-id="minimed.core.ru"
          >
            <div class="setup-core__row">
              <span
                class="setup-core__icon"
                classList={{ 'setup-core__icon--ready': props.coreReady }}
              >
                <AppGlyph
                  name={props.coreReady ? 'check' : props.coreError ? 'info' : 'download'}
                  class="setup-core__glyph"
                />
              </span>
              <div class="setup-core__copy">
                <strong class="setup-core__title">Ядро знаний</strong>
                <span class="setup-core__status" role="status" aria-live="polite">
                  {coreStatus()}
                </span>
              </div>
              <Show when={!props.coreReady && percent() !== undefined}>
                <span class="setup-core__percent">{Math.floor(percent() ?? 0)}%</span>
              </Show>
            </div>
            <Show when={!props.coreReady && !props.coreError && !props.coreDeferred}>
              <DownloadProgress
                class="setup-core__progress"
                value={percent()}
                label="Загрузка ядра знаний"
              />
            </Show>
            <Show when={props.coreError}>
              {(error) => (
                <div class="setup-core__problem">
                  <p class="setup-core__error" role="alert">
                    {error()}
                  </p>
                  <Button variant="primary" onClick={() => window.location.reload()}>
                    Повторить
                  </Button>
                </div>
              )}
            </Show>
            <Show when={props.coreDeferred && !props.coreDownloading}>
              <div class="setup-core__problem">
                <p class="setup-core__hint">
                  Ядро занимает около 490 МБ. Скачайте сейчас или позже через Wi‑Fi.
                </p>
                <Button variant="primary" onClick={props.onDownloadCore}>
                  Скачать · ~490 МБ
                </Button>
              </div>
            </Show>
          </section>

          <section class="first-run-setup__section">
            <h3 class="first-run-setup__section-title">
              {props.coreReady ? 'Что умеет MiniMed' : 'Пока идёт загрузка — что умеет MiniMed'}
            </h3>
            <FeatureTour />
          </section>

          <Show when={groups().length > 0}>
            <section class="first-run-setup__section">
              <h3 class="first-run-setup__section-title">Дополнительные пакеты</h3>
              <p class="first-run-setup__section-text">
                По желанию: загрузки встают в общую очередь, позже их можно добавить через базу
                знаний.
              </p>
              <div class="first-run-setup__groups">
                <For each={groups()}>
                  {(group) => (
                    <Disclosure
                      title={group.title}
                      description={group.description}
                      meta={group.modules.length}
                      open={expanded().has(group.id)}
                      onToggle={(open) => {
                        const next = new Set(expanded());
                        if (open) next.add(group.id);
                        else next.delete(group.id);
                        setExpanded(next);
                      }}
                    >
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
                    </Disclosure>
                  )}
                </For>
              </div>
            </section>
          </Show>
        </div>
      </div>
      <footer class="first-run-setup__footer">
        <div class="first-run-setup__footer-inner">
          <Show when={canLeaveEarly()}>
            <Button class="first-run-setup__later" variant="quiet" onClick={props.onClose}>
              {props.coreDeferred ? 'Позже' : 'Открыть без поиска'}
            </Button>
          </Show>
          <Button
            class="first-run-setup__start"
            variant="primary"
            disabled={!props.coreReady}
            onClick={props.onClose}
          >
            {footerLabel()}
          </Button>
        </div>
      </footer>
    </OverlayDialog>
  );
}
