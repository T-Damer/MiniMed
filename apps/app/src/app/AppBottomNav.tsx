import { type Accessor, type JSX, Show } from 'solid-js';

import type { RootView, RootViewItem } from '@/app/root-view';
import { BottomNav } from '@/components/BottomNav';

function compactCount(value: number, cap: number): string {
  return value > cap ? `${cap}+` : String(value);
}

export function AppBottomNav(props: {
  readonly view: Accessor<RootView>;
  readonly items: Accessor<readonly RootViewItem[]>;
  readonly downloadsReady?: Accessor<boolean>;
  readonly dragIndex: Accessor<number | undefined>;
  readonly dragging: Accessor<boolean>;
  readonly pressed: Accessor<boolean>;
  readonly availableModuleCount: Accessor<number>;
  readonly downloadedModuleCount: Accessor<number>;
  readonly dueReminderCount: Accessor<number>;
  readonly newsUnreadCount: Accessor<number>;
  /** A dot on «Настройки»; nothing floats above the bar (owner 2026-10-19). */
  readonly appUpdateReady: Accessor<boolean>;
  readonly bubbleStyle: () => string;
  readonly bindNav: (element: HTMLElement) => void;
  readonly onPrefetch: (next: RootView) => void;
  readonly onPointerDown: (event: PointerEvent) => void;
  readonly onPointerMove: (event: PointerEvent) => void;
  readonly onPointerUp: (event: PointerEvent) => void;
  readonly onPointerCancel: (event: PointerEvent) => void;
  readonly onItemClick: (next: RootView) => void;
}): JSX.Element {
  return (
    <BottomNav
      view={props.view}
      items={props.items}
      label="Разделы приложения"
      tour="nav"
      itemLabel={(item) => {
        if (item.id === 'modules') {
          return `${item.label}, доступно: ${props.availableModuleCount()}, загружено: ${props.downloadedModuleCount()}`;
        }
        if (item.id === 'notes' && props.dueReminderCount() > 0) {
          return `${item.label}, напоминаний: ${props.dueReminderCount()}`;
        }
        if (item.id === 'news' && props.newsUnreadCount() > 0) {
          return `${item.label}, непрочитанных: ${props.newsUnreadCount()}`;
        }
        if (item.id === 'settings' && props.appUpdateReady()) {
          return `${item.label}, доступно обновление приложения`;
        }
        return item.label;
      }}
      badges={(item) => (
        <>
          <Show when={item.id === 'settings' && props.appUpdateReady()}>
            <span class="app-nav-badge app-nav-badge--app-update" aria-hidden="true" />
          </Show>
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
          <Show when={item.id === 'news' && props.newsUnreadCount() > 0}>
            <span
              class="app-nav-badge app-nav-badge--news"
              data-testid="news-unread-badge"
              aria-hidden="true"
            >
              {compactCount(props.newsUnreadCount(), 99)}
            </span>
          </Show>
          <Show when={item.id === 'notes' && props.dueReminderCount() > 0}>
            <span class="app-nav-badge app-nav-badge--reminder" aria-hidden="true">
              {compactCount(props.dueReminderCount(), 9)}
            </span>
          </Show>
        </>
      )}
      dragIndex={props.dragIndex}
      dragging={props.dragging}
      pressed={props.pressed}
      bubbleStyle={props.bubbleStyle}
      bindNav={props.bindNav}
      onPrefetch={props.onPrefetch}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      onItemClick={props.onItemClick}
    />
  );
}
