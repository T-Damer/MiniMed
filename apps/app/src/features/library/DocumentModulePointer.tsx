import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { formatModuleBytes } from '@/features/modules/module-display';
import type { ModulePointerResolution } from '@/features/modules/module-pointer-install';

interface DocumentModulePointerProps {
  readonly modulePointer?: ModulePointerResolution | null;
  readonly modulePointerPending?: boolean;
  readonly modulePointerProgress?: number | null;
  readonly modulePointerInstallError?: string | null;
  readonly onInstallModulePointer?: () => Promise<void>;
}

export function DocumentModulePointer(props: DocumentModulePointerProps): JSX.Element {
  const modulePointerButtonLabel = (): string => {
    if (!props.modulePointerPending) return 'Скачать набор';
    if (props.modulePointerProgress !== null && props.modulePointerProgress !== undefined) {
      return `${Math.min(100, Math.round(props.modulePointerProgress * 100))}%`;
    }
    return 'Загружаем набор…';
  };
  return (
    <Show when={props.modulePointer}>
      {(resolution) => (
        <section class="document-module-pointer" aria-labelledby="document-module-pointer-title">
          <p class="document-module-pointer__eyebrow">Дополнительный набор</p>
          <h2 id="document-module-pointer-title" class="document-module-pointer__title">
            {resolution().state === 'unavailable'
              ? 'Полный документ пока недоступен'
              : resolution().state === 'installed'
                ? 'Подключение полного документа'
                : 'Полный документ доступен после загрузки'}
          </h2>
          <Show when={resolution().module}>
            {(module) => (
              <p class="document-module-pointer__details">
                {module().title} · {formatModuleBytes(module().sizes.downloadBytes)}
              </p>
            )}
          </Show>
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
          <Show when={resolution().state === 'available' && Boolean(props.onInstallModulePointer)}>
            <Button
              type="button"
              variant="primary"
              class="document-module-pointer__action"
              disabled={props.modulePointerPending}
              onClick={() => void props.onInstallModulePointer?.()}
              icon={
                <AppGlyph
                  name={props.modulePointerPending ? 'refresh' : 'download'}
                  class="document-module-pointer__action-icon"
                />
              }
            >
              {modulePointerButtonLabel()}
            </Button>
          </Show>
        </section>
      )}
    </Show>
  );
}
