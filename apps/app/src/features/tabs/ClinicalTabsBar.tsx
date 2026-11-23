import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import { visitRoute } from '@/state/app-back';
import {
  activateClinicalTab,
  type ClinicalTabKind,
  type ClinicalTabSnapshot,
  type ClinicalTabsState,
  closeClinicalTab,
  closeOtherClinicalTabs,
  loadClinicalTabsState,
  subscribeClinicalTabs,
  syncRouteToClinicalTabs,
  togglePinClinicalTab,
  updateActiveClinicalTabTitle,
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
      return 'Дневники';
    case 'patients':
      return 'Пациенты';
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
 * Opt-in Clinical Tabs («Вкладки»): a single round water-drop satellite button emerging to the
 * left of the bottom navigation bar once 2+ screens/tools are open. Never obscures page headers
 * or bottom-right floating actions; tapping opens the card-grid tab switcher.
 */
export function ClinicalTabsBar(props: { readonly currentHash: string }): JSX.Element {
  const [state, setState] = createSignal<ClinicalTabsState>(loadClinicalTabsState());
  const [switcherOpen, setSwitcherOpen] = createSignal(false);

  onMount(() => {
    let titleTimer: number | undefined;
    const syncHeading = (): void => {
      window.clearTimeout(titleTimer);
      titleTimer = window.setTimeout(() => {
        const heading = document
          .querySelector<HTMLElement>('.app-view.active h1, .app-view--document-read.active h1')
          ?.textContent?.trim();
        if (heading) updateActiveClinicalTabTitle(heading);
      }, 120);
    };
    const syncCurrent = (hash: string): void => {
      setState(syncRouteToClinicalTabs(hash));
      syncHeading();
    };
    syncCurrent(props.currentHash);
    const unsubscribe = subscribeClinicalTabs((next) => setState(next));
    const onHash = (): void => syncCurrent(window.location.hash);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    onCleanup(() => {
      window.clearTimeout(titleTimer);
      unsubscribe();
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    });
  });

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

  const visible = () => state().tabs.length >= 2;

  return (
    <Show when={visible()}>
      <Portal>
        <button
          type="button"
          class="clinical-tabs-drop"
          data-testid="clinical-tabs-button"
          aria-label={`Открытые вкладки (${state().tabs.length})`}
          title={`Вкладки (${state().tabs.length})`}
          onClick={() => setSwitcherOpen(true)}
        >
          <AppGlyph name="browsers" class="clinical-tabs-drop__icon" />
          <span class="clinical-tabs-drop__badge" aria-hidden="true">
            {state().tabs.length}
          </span>
        </button>

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
