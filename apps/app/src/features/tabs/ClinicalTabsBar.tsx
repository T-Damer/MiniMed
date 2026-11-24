import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { BOTTOM_LEFT_CONTROLS_HOST_ID } from '@/components/FloatingActionButton';
import { OverlayDialog } from '@/components/OverlayDialog';
import { visitRoute } from '@/state/app-back';
import {
  activateClinicalTab,
  type ClinicalTabKind,
  type ClinicalTabSnapshot,
  type ClinicalTabsState,
  closeClinicalTab,
  closeOtherClinicalTabs,
  hotClinicalTabIds,
  loadClinicalTabsState,
  subscribeClinicalTabs,
  syncRouteToClinicalTabs,
  togglePinClinicalTab,
  updateActiveClinicalTabSnapshot,
} from '@/state/clinical-tabs';

import '@/features/tabs/clinical-tabs.css';

function tabGlyph(kind: ClinicalTabKind): AppGlyphName {
  switch (kind) {
    case 'search':
      return 'search';
    case 'user':
      return 'file-text';
    case 'diary':
      return 'calendar-check';
    case 'patients':
      return 'users';
    case 'notes':
      return 'notes';
    case 'calculator':
      return 'calculator';
    case 'assessment':
      return 'list-checks';
    case 'modules':
      return 'books';
    case 'news':
      return 'newspaper';
    case 'official':
      return 'book-open';
  }
}

function tabKindLabel(kind: ClinicalTabKind): string {
  switch (kind) {
    case 'search':
      return 'Поиск';
    case 'user':
      return 'Личный файл';
    case 'diary':
      return 'Дневник';
    case 'patients':
      return 'Пациент';
    case 'notes':
      return 'Заметки';
    case 'calculator':
      return 'Калькулятор';
    case 'assessment':
      return 'Опросник';
    case 'modules':
      return 'База знаний';
    case 'news':
      return 'Лента';
    case 'official':
      return 'Документ';
  }
}

/**
 * Captures a lightweight frozen text snapshot (zero layout reads) from the currently visible view
 * so each tab card in the grid displays what the doctor left on that screen.
 */
function captureVisibleScreenSnapshot(): {
  readonly title?: string;
  readonly subtitle?: string;
  readonly preview?: readonly string[];
} {
  const root = document.querySelector<HTMLElement>(
    '.app-view--document-read.active, .app-view.active',
  );
  if (!root) return {};
  const title = root.querySelector<HTMLElement>('h1')?.textContent?.replace(/\s+/gu, ' ').trim();
  const subtitle = root
    .querySelector<HTMLElement>(
      '.drug-header__meta, .page__description, .patient-card__meta, .document-overlay-subtitle',
    )
    ?.textContent?.replace(/\s+/gu, ' ')
    .trim();
  const lines: string[] = [];
  const seen = new Set<string>(title ? [title] : []);
  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>(
      'h2, h3, p, .result-group__title, .patient-workspace__event-title, .drug-links__line',
    ),
  );
  for (const node of nodes) {
    if (lines.length >= 4) break;
    const text = node.textContent?.replace(/\s+/gu, ' ').trim();
    if (!text || text.length < 4 || seen.has(text)) continue;
    seen.add(text);
    lines.push(text.length > 96 ? `${text.slice(0, 95)}…` : text);
  }
  return {
    ...(title ? { title } : {}),
    ...(subtitle ? { subtitle: subtitle.slice(0, 80) } : {}),
    ...(lines.length > 0 ? { preview: lines } : {}),
  };
}

/**
 * Opt-in Clinical Tabs («Вкладки»): a single round water-drop satellite button emerging to the
 * left of the bottom navigation bar once 2+ clinical screens are open. Tapping opens a 2-column
 * visual grid of cards showing each tab's frozen page snapshot and memory state.
 */
export function ClinicalTabsBar(props: { readonly currentHash: string }): JSX.Element {
  const [state, setState] = createSignal<ClinicalTabsState>(loadClinicalTabsState());
  const [switcherOpen, setSwitcherOpen] = createSignal(false);
  const [leftDock, setLeftDock] = createSignal<HTMLElement | undefined>(
    typeof document === 'undefined'
      ? undefined
      : (document.getElementById(BOTTOM_LEFT_CONTROLS_HOST_ID) ?? undefined),
  );

  const captureCurrent = (): void => {
    const snap = captureVisibleScreenSnapshot();
    if (snap.title || snap.subtitle || snap.preview) {
      updateActiveClinicalTabSnapshot(snap);
    }
  };

  onMount(() => {
    setLeftDock(document.getElementById(BOTTOM_LEFT_CONTROLS_HOST_ID) ?? undefined);
    let titleTimer: number | undefined;
    const scheduleCapture = (): void => {
      window.clearTimeout(titleTimer);
      titleTimer = window.setTimeout(captureCurrent, 220);
    };
    const syncCurrent = (hash: string): void => {
      setState(syncRouteToClinicalTabs(hash));
      scheduleCapture();
    };
    syncCurrent(props.currentHash);
    const unsubscribe = subscribeClinicalTabs((next) => setState(next));
    const onHash = (): void => {
      captureCurrent();
      syncCurrent(window.location.hash);
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    onCleanup(() => {
      window.clearTimeout(titleTimer);
      unsubscribe();
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    });
  });

  const openSwitcher = (): void => {
    captureCurrent();
    setSwitcherOpen(true);
  };

  const openTab = (tab: ClinicalTabSnapshot): void => {
    activateClinicalTab(tab.id);
    setSwitcherOpen(false);
    if (window.location.hash !== tab.hash) {
      visitRoute(tab.hash);
    }
  };

  const handleCloseTab = (event: MouseEvent, tab: ClinicalTabSnapshot): void => {
    event.stopPropagation();
    const wasActive = tab.id === state().activeTabId;
    const { nextActive } = closeClinicalTab(tab.id);
    if (wasActive && window.location.hash !== nextActive.hash) {
      visitRoute(nextActive.hash);
    }
  };

  const openSearchTab = (): void => {
    const searchTab = state().tabs.find((tab) => tab.kind === 'search');
    if (searchTab) {
      openTab(searchTab);
    } else {
      setSwitcherOpen(false);
      visitRoute('#/search');
    }
  };

  const hotIds = (): ReadonlySet<string> => new Set(hotClinicalTabIds(state()));
  const visible = () => state().tabs.length >= 2;

  return (
    <Show when={visible()}>
      <Portal mount={leftDock() ?? document.body}>
        <button
          type="button"
          class="clinical-tabs-drop"
          classList={{ 'clinical-tabs-drop--docked': Boolean(leftDock()) }}
          data-testid="clinical-tabs-button"
          aria-label={`Открытые вкладки (${state().tabs.length})`}
          title={`Вкладки (${state().tabs.length})`}
          onClick={openSwitcher}
        >
          <AppGlyph name="browsers" class="clinical-tabs-drop__icon" />
          <span class="clinical-tabs-drop__badge" aria-hidden="true">
            {state().tabs.length}
          </span>
        </button>
      </Portal>
      <Portal>
        <OverlayDialog
          open={switcherOpen()}
          title={`Вкладки (${state().tabs.length})`}
          class="clinical-tabs-sheet"
          onClose={() => setSwitcherOpen(false)}
        >
          <div class="clinical-tabs-grid">
            <div class="clinical-tabs-grid__actions">
              <button type="button" class="clinical-tabs-grid__action" onClick={openSearchTab}>
                <AppGlyph name="search" class="clinical-tabs-grid__action-icon" />
                Новый поиск
              </button>
              <Show
                when={state().tabs.some((tab) => !tab.pinned && tab.id !== state().activeTabId)}
              >
                <button
                  type="button"
                  class="clinical-tabs-grid__action"
                  onClick={() => closeOtherClinicalTabs(state().activeTabId)}
                >
                  <AppGlyph name="trash" class="clinical-tabs-grid__action-icon" />
                  Закрыть остальные
                </button>
              </Show>
            </div>
            <ul class="clinical-tabs-grid__list">
              <For each={state().tabs}>
                {(tab) => {
                  const isActive = () => tab.id === state().activeTabId;
                  const isFrozen = () => !hotIds().has(tab.id);
                  return (
                    <li
                      class={`clinical-tabs-card clinical-tabs-card--kind-${tab.kind}`}
                      classList={{
                        'clinical-tabs-card--active': isActive(),
                        'clinical-tabs-card--frozen': isFrozen(),
                      }}
                    >
                      <div class="clinical-tabs-card__chrome">
                        <span class="clinical-tabs-card__chrome-id">
                          <AppGlyph name={tabGlyph(tab.kind)} class="clinical-tabs-card__icon" />
                          <span class="clinical-tabs-card__kind">{tabKindLabel(tab.kind)}</span>
                        </span>
                        <Show when={tab.kind !== 'search'}>
                          <div class="clinical-tabs-card__tools">
                            <button
                              type="button"
                              class="clinical-tabs-card__tool"
                              classList={{
                                'clinical-tabs-card__tool--pinned': Boolean(tab.pinned),
                              }}
                              aria-label={tab.pinned ? 'Открепить вкладку' : 'Закрепить вкладку'}
                              aria-pressed={Boolean(tab.pinned)}
                              onClick={() => togglePinClinicalTab(tab.id)}
                            >
                              <AppGlyph name="push-pin" class="clinical-tabs-card__tool-icon" />
                            </button>
                            <button
                              type="button"
                              class="clinical-tabs-card__tool"
                              aria-label={`Закрыть «${tab.title}»`}
                              onClick={(event) => handleCloseTab(event, tab)}
                            >
                              <AppGlyph name="close" class="clinical-tabs-card__tool-icon" />
                            </button>
                          </div>
                        </Show>
                      </div>
                      <button
                        type="button"
                        class="clinical-tabs-card__preview"
                        aria-current={isActive() ? 'page' : undefined}
                        onClick={() => openTab(tab)}
                      >
                        <span class="clinical-tabs-card__title">{tab.title}</span>
                        <Show when={tab.subtitle}>
                          {(sub) => <span class="clinical-tabs-card__subtitle">{sub()}</span>}
                        </Show>
                        <div class="clinical-tabs-card__snapshot" aria-hidden="true">
                          <Show
                            when={tab.preview && tab.preview.length > 0}
                            fallback={
                              <div class="clinical-tabs-card__skeleton">
                                <span class="clinical-tabs-card__skeleton-bar clinical-tabs-card__skeleton-bar--wide" />
                                <span class="clinical-tabs-card__skeleton-bar" />
                                <span class="clinical-tabs-card__skeleton-bar clinical-tabs-card__skeleton-bar--short" />
                              </div>
                            }
                          >
                            <For each={tab.preview}>
                              {(line) => <span class="clinical-tabs-card__line">{line}</span>}
                            </For>
                          </Show>
                        </div>
                        <span
                          class="clinical-tabs-card__state"
                          classList={{
                            'clinical-tabs-card__state--active': isActive(),
                            'clinical-tabs-card__state--frozen': isFrozen(),
                          }}
                        >
                          {isActive() ? 'Открыта' : isFrozen() ? 'Снимок' : 'В памяти'}
                        </span>
                      </button>
                    </li>
                  );
                }}
              </For>
            </ul>
          </div>
        </OverlayDialog>
      </Portal>
    </Show>
  );
}
