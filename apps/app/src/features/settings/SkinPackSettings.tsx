import { type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { FeatureCard } from '@/components/FeatureCard';
import { useSkinPack } from '@/features/skin/use-skin-pack';
import { formatByteSize } from '@/i18n/format-number';
import { experimentalModulesEnabled } from '@/state/experimental-modules';

/**
 * «Кожа по фото»: the skin pack (the model and the atlas photos) with its size, download and
 * removal. Shown with experimental modules on, once a pack is published or installed.
 */
export function SkinPackSettings(): JSX.Element {
  const pack = useSkinPack();
  const item = () => pack.offer();
  const status = (): string => {
    const task = pack.task();
    if (pack.busy() === 'remove') return 'Удаляем…';
    if (pack.busy() === 'download') {
      if (task?.state === 'verifying') return 'Проверяем файлы…';
      if (task?.state === 'installing') return 'Устанавливаем…';
      if (task?.state === 'queued') return 'В очереди';
      return `Скачивается · ${Math.floor(pack.fraction() * 100)}%`;
    }
    if (pack.outdated())
      return `Доступно обновление · ${formatByteSize(item()?.downloadBytes ?? 0)}`;
    if (pack.installed()) return 'Готово к работе';
    return `Не скачано · ${formatByteSize(item()?.downloadBytes ?? 0)}`;
  };
  return (
    <Show when={experimentalModulesEnabled() && (pack.installed() || item())}>
      <FeatureCard
        class="skin-pack-settings"
        headingId="settings-skin-pack-heading"
        icon="camera"
        title="Кожа по фото"
        summary="Модель сходства снимка с состояниями кожи и справочные фотографии для атласа. Снимки не покидают устройство."
        status={status()}
        tone={
          pack.error() ? 'error' : pack.busy() ? 'working' : pack.installed() ? 'ready' : 'idle'
        }
        {...(pack.busy() === 'download' ? { progress: pack.fraction() || null } : {})}
        {...(pack.error() ? { error: pack.error() } : {})}
        actions={
          <>
            <Show when={(!pack.installed() || pack.outdated()) && item() && !pack.busy()}>
              <Button type="button" variant="primary" onClick={() => void pack.install()}>
                {pack.outdated() ? 'Обновить' : 'Скачать'}
              </Button>
            </Show>
            <Show when={pack.busy() === 'download'}>
              <Button
                type="button"
                variant="quiet"
                disabled={!pack.task()?.canCancel}
                onClick={pack.cancel}
              >
                Отменить
              </Button>
            </Show>
            <Show when={pack.installed() && pack.busy() !== 'download'}>
              <Button
                type="button"
                variant="quiet"
                disabled={pack.busy() !== null}
                onClick={() => void pack.remove()}
              >
                Удалить
              </Button>
            </Show>
          </>
        }
        detailsTitle="Что внутри"
        details={
          <p>
            Модель обучена на открытых фотографиях кожи. Фотографии атласа — из SCIN (Google),
            PAD-UFES-20 и Wikimedia Commons; автор и лицензия показаны в открытом снимке.
          </p>
        }
      />
    </Show>
  );
}
