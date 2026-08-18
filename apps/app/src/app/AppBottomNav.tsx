import { type Accessor, type JSX, Show } from 'solid-js';

import { ROOT_VIEW_ORDER, ROOT_VIEWS, type RootView } from '@/app/root-view';
import { AppGlyph } from '@/components/AppGlyph';
import type { LocalModelController } from '@/features/models/controller';
import { ModelNavIndicator } from '@/features/models/ModelNavIndicator';
import { ContentDownloadNavIndicator } from '@/features/modules/ContentDownloadNavIndicator';

function compactCount(value: number, cap: number): string {
  return value > cap ? `${cap}+` : String(value);
}

export function AppBottomNav(props: {
  readonly view: Accessor<RootView>;
  readonly dragIndex: Accessor<number | undefined>;
  readonly dragging: Accessor<boolean>;
  readonly pressed: Accessor<boolean>;
  readonly availableModuleCount: Accessor<number>;
  readonly downloadedModuleCount: Accessor<number>;
  readonly dueReminderCount: Accessor<number>;
  readonly modelController: LocalModelController;
  readonly bubbleStyle: () => string;
  readonly bindNav: (element: HTMLElement) => void;
  readonly onPointerDown: (event: PointerEvent) => void;
  readonly onPointerMove: (event: PointerEvent) => void;
  readonly onPointerUp: (event: PointerEvent) => void;
  readonly onPointerCancel: (event: PointerEvent) => void;
  readonly onItemClick: (next: RootView) => void;
}): JSX.Element {
  return (
    <nav
      ref={props.bindNav}
      class="app-bottom-nav"
      classList={{
        'app-bottom-nav--dragging': props.dragging(),
        'app-bottom-nav--pressed': props.pressed(),
      }}
      aria-label="Разделы приложения"
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
    >
      <span class="app-bottom-nav__bubble" style={props.bubbleStyle()} aria-hidden="true" />
      {ROOT_VIEWS.map((item, index) => {
        const selected = () =>
          (props.dragIndex() ?? ROOT_VIEW_ORDER.get(props.view()) ?? 0) === index;
        const label = () => {
          if (item.id === 'modules') {
            return `${item.label}, доступно: ${props.availableModuleCount()}, загружено: ${props.downloadedModuleCount()}`;
          }
          if (item.id === 'notes' && props.dueReminderCount() > 0) {
            return `${item.label}, напоминаний: ${props.dueReminderCount()}`;
          }
          return item.label;
        };
        return (
          <div class="app-nav-item">
            <Show when={item.id === 'settings'}>
              <ContentDownloadNavIndicator />
              <ModelNavIndicator controller={props.modelController} />
            </Show>
            <button
              class="app-nav-button"
              classList={{ 'app-nav-button--active': selected() }}
              type="button"
              aria-label={label()}
              aria-current={props.view() === item.id ? 'page' : undefined}
              title={label()}
              onClick={() => props.onItemClick(item.id)}
            >
              <AppGlyph
                name={item.icon}
                class={`app-nav-button__icon${selected() ? ' app-nav-button__icon--active' : ''}`}
              />
              <Show when={item.id === 'modules' && props.availableModuleCount() > 0}>
                <span class="app-nav-badge app-nav-badge--available" aria-hidden="true">
                  {compactCount(props.availableModuleCount(), 99)}
                </span>
              </Show>
              <Show when={item.id === 'modules' && props.downloadedModuleCount() > 0}>
                <span class="app-nav-badge app-nav-badge--downloaded" aria-hidden="true">
                  {compactCount(props.downloadedModuleCount(), 99)}
                </span>
              </Show>
              <Show when={item.id === 'notes' && props.dueReminderCount() > 0}>
                <span class="app-nav-badge app-nav-badge--reminder" aria-hidden="true">
                  {compactCount(props.dueReminderCount(), 9)}
                </span>
              </Show>
            </button>
          </div>
        );
      })}
    </nav>
  );
}
