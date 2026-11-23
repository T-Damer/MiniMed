import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { HorizontalScroller } from '@/components/HorizontalScroller';
import { OverlayDialog } from '@/components/OverlayDialog';
import { visitRoute } from '@/state/app-back';
import {
  activateClinicalTab,
  adjacentClinicalTab,
  type ClinicalTabKind,
  type ClinicalTabSnapshot,
  type ClinicalTabsState,
  closeClinicalTab,
  closeOtherClinicalTabs,
  loadClinicalTabsState,
  subscribeClinicalTabs,
  syncRouteToClinicalTabs,
  togglePinClinicalTab,
} from '@/state/clinical-tabs';
import { hapticFeedback } from '@/state/haptics';
import { uiSounds } from '@/state/ui-sounds';

import '@/features/tabs/clinical-tabs.css';

const SWIPE_THRESHOLD_PX = 48;

function tabGlyph(kind: ClinicalTabKind): AppGlyphName {
  if (kind === 'search') return 'search';
  if (kind === 'user') return 'file-text';
  return 'book-open';
}

function tabKindLabel(kind: ClinicalTabKind): string {
  if (kind === 'search') return 'Поиск';
  if (kind === 'user') return 'Личный файл';
  return 'Документ';
}

/**
 * Opt-in Clinical Tabs («Вкладки документов», Wave 2.1):
 * - Desktop (≥900 px): compact horizontal tab strip at top of the workspace.
 * - Mobile (<900 px): swipeable active-tab pill above the bottom bar + `[N]` card-grid switcher.
 */
export function ClinicalTabsBar(props: { readonly currentHash: string }): JSX.Element {
  const [state, setState] = createSignal<ClinicalTabsState>(loadClinicalTabsState());
  const [switcherOpen, setSwitcherOpen] = createSignal(false);

  let swipeStartX: number | null = null;
  let swipeStartY: number | null = null;

  onMount(() => {
    setState(syncRouteToClinicalTabs(props.currentHash));
    const unsubscribe = subscribeClinicalTabs((next) => setState(next));
    const onHash = (): void => {
      setState(syncRouteToClinicalTabs(window.location.hash));
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    onCleanup(() => {
      unsubscribe();
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    });
  });

  const activeTab = (): ClinicalTabSnapshot | undefined =>
    state().tabs.find((tab) => tab.id === state().activeTabId) ?? state().tabs[0];

  const openTab = (tab: ClinicalTabSnapshot): void => {
    activateClinicalTab(tab.id);
    setSwitcherOpen(false);
    if (window.location.hash !== tab.hash) {
      visitRoute(tab.hash);
    }
  };

  const stepTab = (delta: -1 | 1): void => {
    const next = adjacentClinicalTab(state(), delta);
    if (!next || next.id === state().activeTabId) return;
    uiSounds.play('swipe');
    hapticFeedback('selection');
    openTab(next);
  };

  const handleCloseTab = (event: MouseEvent, tab: ClinicalTabSnapshot): void => {
    event.stopPropagation();
    const wasActive = tab.id === state().activeTabId;
    const { nextActive } = closeClinicalTab(tab.id);
    if (wasActive && window.location.hash !== nextActive.hash) {
      visitRoute(nextActive.hash);
    }
  };

  const handlePillPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    swipeStartX = event.clientX;
    swipeStartY = event.clientY;
  };

  const handlePillPointerUp = (event: PointerEvent): void => {
    if (swipeStartX === null || swipeStartY === null) return;
    const dx = event.clientX - swipeStartX;
    const dy = event.clientY - swipeStartY;
    swipeStartX = null;
    swipeStartY = null;
    if (Math.abs(dx) >= SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy) * 1.4) {
      stepTab(dx < 0 ? 1 : -1);
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

  const visible = () => state().tabs.length >= 2;

  return (
    <Show when={visible()}>
      <Portal>
        {/* Desktop (≥900 px) top tab strip */}
        <nav
          class="clinical-tabs-strip"
          aria-label="Открытые вкладки"
          data-testid="clinical-tabs-strip"
        >
          <HorizontalScroller
            class="clinical-tabs-strip__scroller"
            controls
            hideScrollbar
            light
            controlLabel="вкладки"
          >
            <ul class="clinical-tabs-strip__list">
              <For each={state().tabs}>
                {(tab) => {
                  const isActive = () => tab.id === state().activeTabId;
                  return (
                    <li
                      class="clinical-tabs-strip__item"
                      classList={{ 'clinical-tabs-strip__item--active': isActive() }}
                    >
                      <button
                        type="button"
                        class="clinical-tabs-strip__tab"
                        classList={{ 'clinical-tabs-strip__tab--active': isActive() }}
                        aria-current={isActive() ? 'page' : undefined}
                        onClick={() => openTab(tab)}
                      >
                        <AppGlyph name={tabGlyph(tab.kind)} class="clinical-tabs-strip__icon" />
                        <span class="clinical-tabs-strip__title">{tab.title}</span>
                      </button>
                      <Show when={tab.kind !== 'search'}>
                        <button
                          type="button"
                          class="clinical-tabs-strip__close"
                          aria-label={`Закрыть вкладку «${tab.title}»`}
                          onClick={(event) => handleCloseTab(event, tab)}
                        >
                          <AppGlyph name="close" class="clinical-tabs-strip__close-icon" />
                        </button>
                      </Show>
                    </li>
                  );
                }}
              </For>
            </ul>
          </HorizontalScroller>
          <button
            type="button"
            class="clinical-tabs-strip__count"
            aria-label={`Все вкладки (${state().tabs.length})`}
            title="Все вкладки"
            onClick={() => setSwitcherOpen(true)}
          >
            {state().tabs.length}
          </button>
        </nav>

        {/* Mobile (<900 px) swipeable tab pill docked above the bottom bar */}
        <div
          class="clinical-tabs-pill"
          data-testid="clinical-tabs-pill"
          onPointerDown={handlePillPointerDown}
          onPointerUp={handlePillPointerUp}
          onPointerCancel={() => {
            swipeStartX = null;
            swipeStartY = null;
          }}
        >
          <button
            type="button"
            class="clinical-tabs-pill__step"
            aria-label="Предыдущая вкладка"
            onClick={() => stepTab(-1)}
          >
            <AppGlyph name="caret-left" class="clinical-tabs-pill__step-icon" />
          </button>
          <button
            type="button"
            class="clinical-tabs-pill__current"
            aria-label="Открыть список вкладок"
            onClick={() => setSwitcherOpen(true)}
          >
            <AppGlyph
              name={tabGlyph(activeTab()?.kind ?? 'search')}
              class="clinical-tabs-pill__icon"
            />
            <span class="clinical-tabs-pill__title">{activeTab()?.title ?? 'Поиск'}</span>
          </button>
          <button
            type="button"
            class="clinical-tabs-pill__count"
            aria-label={`Открытые вкладки: ${state().tabs.length}`}
            onClick={() => setSwitcherOpen(true)}
          >
            {state().tabs.length}
          </button>
          <button
            type="button"
            class="clinical-tabs-pill__step"
            aria-label="Следующая вкладка"
            onClick={() => stepTab(1)}
          >
            <AppGlyph name="caret-right" class="clinical-tabs-pill__step-icon" />
          </button>
        </div>

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
                  return (
                    <li
                      class="clinical-tabs-card"
                      classList={{ 'clinical-tabs-card--active': isActive() }}
                    >
                      <button
                        type="button"
                        class="clinical-tabs-card__open"
                        aria-current={isActive() ? 'page' : undefined}
                        onClick={() => openTab(tab)}
                      >
                        <span class="clinical-tabs-card__meta">
                          <AppGlyph name={tabGlyph(tab.kind)} class="clinical-tabs-card__icon" />
                          <span class="clinical-tabs-card__kind">{tabKindLabel(tab.kind)}</span>
                        </span>
                        <span class="clinical-tabs-card__title">{tab.title}</span>
                        <Show when={tab.subtitle}>
                          {(sub) => <span class="clinical-tabs-card__subtitle">{sub()}</span>}
                        </Show>
                      </button>
                      <Show when={tab.kind !== 'search'}>
                        <div class="clinical-tabs-card__tools">
                          <button
                            type="button"
                            class="clinical-tabs-card__tool"
                            classList={{ 'clinical-tabs-card__tool--pinned': Boolean(tab.pinned) }}
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
