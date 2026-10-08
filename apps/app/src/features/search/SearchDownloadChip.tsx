import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { createEffect, createMemo, createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { ChoiceChip } from '@/components/ChoiceChip';
import { DownloadProgressMark } from '@/components/DownloadProgressMark';
import {
  contentDownloadPhase,
  downloadPercent,
} from '@/features/modules/content-download-progress';
import { formatModuleBytes } from '@/features/modules/module-display';
import { moduleGroupDownloadProgress } from '@/features/modules/recommendation-categories';
import type { SearchSectionDownloads } from '@/features/search/useSearchSectionDownloads';
import { motionMs } from '@/state/motion';
import '@/features/search/search-download-chip.css';

/** How long «Готово» stays on a chip whose download just finished. */
const DONE_VISIBLE_MS = 1600;

/** Offers the missing modules behind a search result or an empty result list. */
export function SearchDownloadChip(props: {
  readonly label: string;
  /** What the download contains, shown before its size. */
  readonly subject?: string;
  readonly modules: readonly ContentModuleCatalogEntry[];
  readonly downloads: SearchSectionDownloads;
  readonly accent?: boolean | undefined;
  /**
   * One short line for a card header: the visible text is only the size (or the state), the full
   * sentence stays in the accessible name and the tooltip.
   */
  readonly compact?: boolean | undefined;
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
  /** A scheduled install has no task yet: it waits like a queued one. */
  const phase = () => (active() ? (contentDownloadPhase(tasks()) ?? 'queued') : null);
  const progress = createMemo(() =>
    moduleGroupDownloadProgress(props.modules, installed(), tasks()),
  );
  const percent = (): number | null => {
    const fraction = progress().byteProgress;
    return fraction === null ? null : downloadPercent(fraction, true);
  };

  // The chip leaves quietly: after the last pack is installed it says «Готово» before it fades.
  const [done, setDone] = createSignal(false);
  let wasBusy = false;
  let doneTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    if (active()) {
      wasBusy = true;
      return;
    }
    if (!wasBusy) return;
    if (failed()) {
      wasBusy = false;
      return;
    }
    // The install ended: wait until the registry shows the pack as installed, then confirm it.
    if (pending().length > 0) return;
    wasBusy = false;
    setDone(true);
    doneTimer = setTimeout(() => setDone(false), motionMs(DONE_VISIBLE_MS));
  });
  onCleanup(() => clearTimeout(doneTimer));

  const size = () => {
    const bytes = pending().map((module) => module.sizes.downloadBytes);
    return bytes.every((value) => value !== null)
      ? formatModuleBytes(bytes.reduce<number>((sum, value) => sum + (value ?? 0), 0))
      : undefined;
  };
  /** What the chip shows now; a change of it swaps the text with a short fade. */
  const status = () => (done() ? 'done' : (phase() ?? (failed() ? 'failed' : 'idle')));
  const label = () => {
    switch (status()) {
      case 'done':
        return 'Готово';
      case 'queued':
        return 'В очереди';
      case 'installing':
        return 'Устанавливаем…';
      case 'downloading': {
        const value = percent();
        return value === null ? 'Скачиваем…' : `Скачиваем… ${value}%`;
      }
      case 'connecting':
        return 'Скачиваем…';
      case 'failed':
        return 'Повторить загрузку';
      default:
        return props.label;
    }
  };
  const detail = () =>
    [props.subject, active() || done() ? undefined : size()].filter(Boolean).join(' · ') ||
    undefined;
  /** What a compact chip prints: the size while it offers a download, the state afterwards. */
  const compactText = () => {
    switch (status()) {
      case 'downloading': {
        const value = percent();
        return value === null ? 'Скачиваем…' : `${value}%`;
      }
      case 'failed':
        return 'Повторить';
      case 'idle':
        return size() ?? 'Скачать';
      default:
        return label();
    }
  };
  /** The full sentence of a compact chip: what it does, for which document, how large. */
  const compactName = () =>
    active() || done()
      ? `${label()}${props.subject ? ` · ${props.subject}` : ''}`
      : [failed() ? 'Повторить загрузку' : props.label, props.subject, size()]
          .filter(Boolean)
          .join(' · ');
  const markState = () =>
    status() === 'done' ? 'done' : status() === 'queued' ? 'queued' : 'running';
  return (
    <Show when={props.downloads.ready() && (pending().length > 0 || done())}>
      <ChoiceChip
        class={done() ? 'search-download-chip search-download-chip--done' : 'search-download-chip'}
        accent={props.accent}
        compact={props.compact}
        {...(props.compact ? { 'aria-label': compactName(), title: compactName() } : {})}
        icon={
          <Show
            when={active() || done()}
            fallback={
              <AppGlyph
                name={failed() ? 'arrow-counter-clockwise' : 'download'}
                class="choice-chip__glyph"
              />
            }
          >
            <DownloadProgressMark
              state={markState()}
              progress={status() === 'downloading' ? progress().byteProgress : null}
              busy={status() === 'connecting' || status() === 'installing'}
            />
          </Show>
        }
        detail={props.compact ? undefined : detail()}
        disabled={active() || done()}
        aria-live="polite"
        onClick={(event) => {
          event.stopPropagation();
          void props.downloads.install(pending());
        }}
      >
        <Show when={status()} keyed>
          {(_state) => (
            <span class="search-download-chip__state">
              {props.compact ? compactText() : label()}
            </span>
          )}
        </Show>
      </ChoiceChip>
    </Show>
  );
}
