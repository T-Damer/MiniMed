import { createMemo, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { DownloadProgressMark } from '@/components/DownloadProgressMark';
import { isModuleReleased } from '@/features/modules/local-packaged-modules';
import { formatModuleBytes } from '@/features/modules/module-display';
import { useModuleInstaller } from '@/features/sections/use-module-installer';
import { SEVERITY_MODULE_ID } from './interaction-severity';

const FINISHED_TASK_STATES = new Set(['completed', 'failed', 'cancelled']);

/**
 * «Скачать метки степени риска»: the optional DDInter module, queued through the same module
 * runtime as every other download. Mounted only where a pair has instruction sentences and the
 * module is missing, so the catalog is not loaded for a tool that has nothing to offer.
 */
export function SeverityDownloadOffer(props: {
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  const installer = useModuleInstaller(props.onContentChanged, 'Не удалось скачать метки.');
  const entry = createMemo(() =>
    installer.snapshot()?.catalog.modules.find((module) => module.id === SEVERITY_MODULE_ID),
  );
  const installed = () => installer.snapshot()?.installedIds.has(SEVERITY_MODULE_ID) ?? false;
  const active = () =>
    installer.starting() ||
    (installer
      .snapshot()
      ?.tasks.some(
        (task) => task.moduleId === SEVERITY_MODULE_ID && !FINISHED_TASK_STATES.has(task.state),
      ) ??
      false);
  const size = () => {
    const bytes = entry()?.sizes.downloadBytes;
    return typeof bytes === 'number' ? formatModuleBytes(bytes) : null;
  };
  return (
    <Show when={!installed()}>
      <section
        class="drug-interactions__severity-offer paper-card"
        aria-label="Метки степени риска"
        data-testid="severity-offer"
      >
        <p class="drug-interactions__offers-text">
          Метки степени риска из базы DDInter 2.0. Лицензия CC BY-NC-SA 4.0, использование
          некоммерческое.
        </p>
        <Show
          when={entry()}
          fallback={
            <p class="drug-interactions__side-note" role="status">
              {installer.failed()
                ? 'Каталог модулей не загрузился.'
                : 'Проверяем, доступен ли модуль для скачивания…'}
            </p>
          }
        >
          {(module) => (
            <Show
              when={isModuleReleased(module())}
              fallback={
                <p class="drug-interactions__side-note">
                  Модуль меток пока недоступен для скачивания в этой версии приложения.
                </p>
              }
            >
              <Button
                type="button"
                variant="secondary"
                class="drug-interactions__severity-offer-button"
                disabled={active()}
                data-testid="severity-offer-button"
                icon={
                  <Show when={active()} fallback={<AppGlyph name="download" />}>
                    <DownloadProgressMark state="running" progress={null} />
                  </Show>
                }
                onClick={() => void installer.start([module()])}
              >
                {active()
                  ? 'Скачиваем…'
                  : `Скачать метки степени риска (DDInter)${size() ? `, ${size()}` : ''}`}
              </Button>
            </Show>
          )}
        </Show>
      </section>
    </Show>
  );
}
