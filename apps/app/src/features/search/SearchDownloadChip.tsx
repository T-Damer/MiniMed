import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { createMemo, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { ChoiceChip } from '@/components/ChoiceChip';
import { DownloadProgressMark } from '@/components/DownloadProgressMark';
import { formatModuleBytes } from '@/features/modules/module-display';
import { moduleGroupDownloadProgress } from '@/features/modules/recommendation-categories';
import type { SearchSectionDownloads } from '@/features/search/useSearchSectionDownloads';

/** Offers the missing modules behind a search result or an empty result list. */
export function SearchDownloadChip(props: {
  readonly label: string;
  /** What the download contains, shown before its size. */
  readonly subject?: string;
  readonly modules: readonly ContentModuleCatalogEntry[];
  readonly downloads: SearchSectionDownloads;
  readonly accent?: boolean | undefined;
}): JSX.Element {
  const installed = createMemo(() => props.downloads.installedIds(props.modules));
  const pending = createMemo(() => props.modules.filter((module) => !installed().has(module.id)));
  const tasks = createMemo(() =>
    props.downloads
      .visibleTasks()
      .filter((task) =>
        props.modules.some(
          (module) => module.id === task.moduleId && module.version === task.version,
        ),
      ),
  );
  const active = () => props.modules.some((module) => props.downloads.activeIds().has(module.id));
  const failed = () => tasks().some((task) => task.state === 'failed');
  const running = () =>
    tasks().some(
      (task) =>
        task.state === 'downloading' || task.state === 'verifying' || task.state === 'installing',
    );
  const progress = createMemo(() =>
    moduleGroupDownloadProgress(props.modules, installed(), tasks()),
  );
  const size = () => {
    const bytes = pending().map((module) => module.sizes.downloadBytes);
    return bytes.every((value) => value !== null)
      ? formatModuleBytes(bytes.reduce<number>((sum, value) => sum + (value ?? 0), 0))
      : undefined;
  };
  const label = () => {
    if (active() && !running()) return 'В очереди';
    if (active()) {
      const fraction = progress().byteProgress;
      return fraction === null ? 'Скачиваем…' : `Скачиваем… ${Math.floor(fraction * 100)}%`;
    }
    return failed() ? 'Повторить загрузку' : props.label;
  };
  const detail = () =>
    [props.subject, active() ? undefined : size()].filter(Boolean).join(' · ') || undefined;
  return (
    <Show when={props.downloads.ready() && pending().length > 0}>
      <ChoiceChip
        class="search-download-chip"
        accent={props.accent}
        icon={
          <Show
            when={active()}
            fallback={
              <AppGlyph
                name={failed() ? 'arrow-counter-clockwise' : 'download'}
                class="choice-chip__glyph"
              />
            }
          >
            <DownloadProgressMark
              state={running() ? 'running' : 'queued'}
              progress={progress().byteProgress}
            />
          </Show>
        }
        detail={detail()}
        disabled={active()}
        aria-live="polite"
        onClick={(event) => {
          event.stopPropagation();
          void props.downloads.install(pending());
        }}
      >
        {label()}
      </ChoiceChip>
    </Show>
  );
}
