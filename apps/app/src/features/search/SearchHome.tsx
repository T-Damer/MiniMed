import type { MedicalCore } from '@localmed/contracts';
import { createMemo, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import { useStickySurface } from '@/components/sticky-surface';
import { SearchHistoryPanel } from '@/features/history/SearchHistoryPanel';
import { ScopedMedicalCore } from '@/features/search/ScopedMedicalCore';
import { SearchWorkspace } from '@/features/search/SearchWorkspace';
import {
  ignoreAppUpdate,
  isHomeAppUpdateVisible,
  loadIgnoredAppUpdates,
} from '@/state/ignored-app-updates';
import { replaySearch, type SearchHistoryEntry } from '@/state/search-history';

interface SearchHomeProps {
  readonly baseCore: MedicalCore;
  readonly active: boolean;
  readonly onOpenKnowledgeBase: () => void;
  readonly appUpdateVersion?: string;
  readonly onOpenAppUpdateSettings?: () => void;
}

export function SearchHome(props: SearchHomeProps): JSX.Element {
  const [helpOpen, setHelpOpen] = createSignal(false);
  const [hasSearchScroll, setHasSearchScroll] = createSignal(false);
  const [ignoredAppUpdates, setIgnoredAppUpdates] = createSignal(loadIgnoredAppUpdates());
  let searchModeTools: HTMLElement | undefined;
  let searchScrollFrame: number | undefined;
  useStickySurface(() => searchModeTools);

  onMount(() => {
    const updateSearchScroll = (): void => {
      if (searchScrollFrame !== undefined) return;
      searchScrollFrame = requestAnimationFrame(() => {
        searchScrollFrame = undefined;
        setHasSearchScroll(window.scrollY > 1);
      });
    };
    updateSearchScroll();
    window.addEventListener('scroll', updateSearchScroll, { passive: true });
    onCleanup(() => window.removeEventListener('scroll', updateSearchScroll));
  });

  onCleanup(() => {
    if (searchScrollFrame !== undefined) cancelAnimationFrame(searchScrollFrame);
  });

  const scopedCore = createMemo(() => new ScopedMedicalCore(props.baseCore, 'all'));
  const replayHistory = (entry: SearchHistoryEntry): void => {
    replaySearch({ ...entry, scope: 'all' });
  };

  return (
    <section class="search-home page-grain" aria-label="Поиск MiniMed">
      <div
        class="search-home__backdrop-blur masked-backdrop-blur"
        classList={{ 'search-home__backdrop-blur--visible': hasSearchScroll() }}
        aria-hidden="true"
      />
      <div
        class="search-mode-tools route-sticky-chrome--transparent"
        ref={(element) => {
          searchModeTools = element;
        }}
      >
        <Show when={props.active}>
          <SearchHistoryPanel onReplay={replayHistory} />
        </Show>
        <Show when={isHomeAppUpdateVisible(props.appUpdateVersion, ignoredAppUpdates())}>
          <button
            class="search-update-status"
            type="button"
            aria-label="Доступно обновление"
            title="Доступно обновление"
            onClick={() => {
              const version = props.appUpdateVersion;
              if (version) setIgnoredAppUpdates(ignoreAppUpdate(version));
              props.onOpenAppUpdateSettings?.();
            }}
          >
            <AppGlyph name="refresh" class="search-update-status__icon" />
            <span class="search-update-status__label">Доступно обновление</span>
          </button>
        </Show>
        <button
          class="search-mode-help"
          type="button"
          aria-label="Как работает поиск"
          onClick={() => setHelpOpen(true)}
        >
          ?
        </button>
      </div>

      <div class="search-workspace-main">
        <SearchWorkspace
          core={scopedCore()}
          scope="all"
          searchAllowed
          placeholder="Например: 5 лет, мальчик, второй день кашляет и температурит…"
          modePicker={
            <span class="search-mode-picker search-mode-picker--single">Свободный поиск</span>
          }
        />
      </div>

      <OverlayDialog
        open={helpOpen()}
        title="Как работает поиск"
        class="diagnosis-help-dialog"
        onClose={() => setHelpOpen(false)}
      >
        <div class="diagnosis-help-copy">
          <p>
            MiniMed локально ищет и ранжирует подходящие файлы в установленных источниках. Поиск не
            генерирует медицинский ответ и остаётся доступен без сети.
          </p>
          <ul>
            <li>В выдаче показываются только исходные документы и точные фрагменты.</li>
            <li>Для клинического случая сначала показываются клинические рекомендации.</li>
            <li>Личные данные ищутся отдельно и не смешиваются с официальными источниками.</li>
            <li>Результат не заменяет осмотр, клиническое мышление и ответственность врача.</li>
          </ul>
        </div>
      </OverlayDialog>
    </section>
  );
}
