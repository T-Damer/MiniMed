import { createMemo, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { downloadNavPieBackground } from '@/features/modules/content-download-progress';
import { formatModuleBytes } from '@/features/modules/module-display';
import { moduleGroupDownloadProgress } from '@/features/modules/recommendation-categories';
import type { SearchDownloadBlock } from '@/features/search/searchSectionDownloads';
import type { useSearchSectionDownloads } from '@/features/search/useSearchSectionDownloads';

export function SearchSectionDownload(props: {
  readonly label: string;
  readonly block: SearchDownloadBlock;
  readonly downloads: ReturnType<typeof useSearchSectionDownloads>;
  readonly noDownload?: boolean;
  readonly loading?: boolean;
}): JSX.Element {
  const installed = createMemo(() => props.downloads.installedIds(props.block.modules));
  const tasks = createMemo(() =>
    props.downloads
      .visibleTasks()
      .filter((task) =>
        props.block.modules.some(
          (module) => module.id === task.moduleId && module.version === task.version,
        ),
      ),
  );
  const active = () =>
    props.block.modules.some((module) => props.downloads.activeIds().has(module.id));
  const failed = () => tasks().some((task) => task.state === 'failed');
  const progress = createMemo(() =>
    moduleGroupDownloadProgress(props.block.modules, installed(), tasks()),
  );
  const complete = () => installed().size === props.block.modules.length;
  const pending = () => props.block.modules.filter((module) => !installed().has(module.id));
  const bytes = () => pending().reduce((sum, module) => sum + (module.sizes.downloadBytes ?? 0), 0);
  const status = (): string => {
    if (props.noDownload) return 'Без отдельной загрузки';
    if (!props.downloads.ready() || props.loading)
      return props.downloads.error() ? 'Не удалось проверить' : 'Проверяем пакеты…';
    if (active() && complete()) return 'Подключаем…';
    if (active()) {
      if (tasks().some((task) => task.state === 'downloading'))
        return progress().byteProgress === null
          ? 'Загрузка…'
          : `Загрузка: ${Math.floor((progress().byteProgress ?? 0) * 100)}%`;
      if (tasks().some((task) => task.state === 'verifying')) return 'Проверка…';
      if (tasks().some((task) => task.state === 'installing')) return 'Установка…';
      return 'В очереди';
    }
    if (failed()) return 'Ошибка · повторить';
    if (props.block.modules.length)
      return `Пакеты: ${installed().size}/${props.block.modules.length}${props.block.unavailable ? ' · не всё доступно' : ''}`;
    if (props.block.unavailable) return 'Пока недоступно';
    return props.block.local ? 'Доступно офлайн' : 'Нет пакетов';
  };
  const compactStatus = (): string => {
    if (!props.downloads.ready() || props.loading) return '…';
    if (active())
      return progress().byteProgress === null
        ? '…'
        : `${Math.floor((progress().byteProgress ?? 0) * 100)}%`;
    return '';
  };
  const title = () =>
    `${props.label}. ${status()}${props.downloads.error() ? `. ${props.downloads.error()}` : ''}${pending().length ? `. Скачать ${bytes() && pending().every((module) => module.sizes.downloadBytes !== null) ? formatModuleBytes(bytes()) : 'доступные пакеты'}` : ''}${
      props.block.modules.length
        ? `\n${props.block.modules
            .slice(0, 6)
            .map((module) => `${installed().has(module.id) ? '✓' : '↓'} ${module.title}`)
            .join('\n')}`
        : ''
    }`;
  return (
    <Show
      when={
        props.block.modules.length > 0 &&
        !props.noDownload &&
        !(props.downloads.ready() && !props.loading && complete() && !active())
      }
    >
      <button
        class="search-section-download"
        classList={{
          'search-section-download--complete': props.downloads.ready() && complete(),
          'search-section-download--failed': failed(),
        }}
        type="button"
        aria-label={`Загрузка: ${props.label}. ${status()}`}
        title={title()}
        disabled={
          props.noDownload || props.loading || !props.downloads.ready() || complete() || active()
        }
        onClick={() => void props.downloads.install(props.block.modules)}
      >
        <Show
          when={active()}
          fallback={
            <AppGlyph
              name={failed() ? 'arrow-counter-clockwise' : complete() ? 'check' : 'download'}
              class="search-section-menu__icon"
            />
          }
        >
          <span
            class="search-section-download__pie"
            style={{ background: downloadNavPieBackground(progress().byteProgress ?? 0.08, false) }}
            aria-hidden="true"
          />
        </Show>
        <span class="search-section-download__status" aria-hidden="true">
          {compactStatus()}
        </span>
      </button>
    </Show>
  );
}
