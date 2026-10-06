import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { formatModuleBytes } from '@/features/modules/module-display';
import type { ModulePointerResolution } from '@/features/modules/module-pointer-install';

interface DocumentModulePointerProps {
  readonly modulePointer?: ModulePointerResolution | null;
  readonly modulePointerPending?: boolean;
  readonly modulePointerProgress?: number | null;
  readonly modulePointerInstallError?: string | null;
  readonly onInstallModulePointer?: () => Promise<void>;
}

/** A set's title in «»; a title that already carries its own quotes is left as it is. */
function quotedTitle(title: string): string {
  return title.includes('«') ? title : `«${title}»`;
}

/**
 * One row above a short card whose full text lives in a downloadable set: what to download on the
 * left, and on the right a button that carries the size, then the download's own progress.
 */
export function DocumentModulePointer(props: DocumentModulePointerProps): JSX.Element {
  const progressPercent = (): number | null => {
    const progress = props.modulePointerProgress;
    return props.modulePointerPending && progress !== null && progress !== undefined
      ? Math.min(100, Math.round(progress * 100))
      : null;
  };
  return (
    <Show when={props.modulePointer}>
      {(resolution) => {
        const module = () => resolution().module;
        const canInstall = () =>
          resolution().state === 'available' && Boolean(props.onInstallModulePointer);
        return (
          <section
            class="document-module-pointer"
            aria-labelledby="document-module-pointer-title"
            aria-busy={props.modulePointerPending === true}
          >
            <div class="document-module-pointer__row">
              <p
                id="document-module-pointer-title"
                class="document-module-pointer__title"
                title={module()?.title}
              >
                <Show
                  when={resolution().state === 'available' ? module() : undefined}
                  fallback={
                    resolution().state === 'unavailable'
                      ? 'Полный документ пока недоступен'
                      : resolution().state === 'installed'
                        ? 'Подключаем полный документ…'
                        : 'Полный документ доступен после загрузки'
                  }
                >
                  {(entry) => (
                    <>
                      Полная версия — в наборе{' '}
                      <span class="document-module-pointer__set">{quotedTitle(entry().title)}</span>
                    </>
                  )}
                </Show>
              </p>
              <Show when={canInstall()}>
                <button
                  type="button"
                  class="document-module-pointer__action"
                  classList={{
                    'document-module-pointer__action--pending': props.modulePointerPending,
                  }}
                  style={
                    progressPercent() === null
                      ? undefined
                      : { '--document-module-pointer-progress': `${progressPercent()}%` }
                  }
                  aria-label={
                    props.modulePointerPending
                      ? `Загружаем набор${progressPercent() === null ? '' : `: ${progressPercent()}%`}`
                      : `Скачать набор ${quotedTitle(module()?.title ?? '')}${
                          module()
                            ? ` · ${formatModuleBytes(module()?.sizes.downloadBytes ?? 0)}`
                            : ''
                        }`
                  }
                  disabled={props.modulePointerPending}
                  onClick={() => void props.onInstallModulePointer?.()}
                >
                  <AppGlyph
                    name={props.modulePointerPending ? 'refresh' : 'download'}
                    class={`document-module-pointer__action-icon${
                      props.modulePointerPending === true && progressPercent() === null
                        ? ' document-module-pointer__action-icon--spinning'
                        : ''
                    }`}
                  />
                  <span class="document-module-pointer__action-label">
                    {progressPercent() !== null
                      ? `${progressPercent()} %`
                      : props.modulePointerPending
                        ? '…'
                        : module()
                          ? formatModuleBytes(module()?.sizes.downloadBytes ?? 0)
                          : 'Скачать'}
                  </span>
                </button>
              </Show>
            </div>
            <Show when={resolution().message}>
              {(message) => (
                <p class="document-module-pointer__message" role="status">
                  {message()}
                </p>
              )}
            </Show>
            <Show when={props.modulePointerInstallError}>
              {(message) => (
                <p class="document-module-pointer__error" role="alert">
                  {message()}
                </p>
              )}
            </Show>
          </section>
        );
      }}
    </Show>
  );
}
