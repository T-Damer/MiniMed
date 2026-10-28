import { type Accessor, For, type JSX, onCleanup } from 'solid-js';

import { watchNavCrowding } from '@/app/nav-crowding';
import type { NavItem } from '@/app/root-view';
import { AppGlyph } from '@/components/AppGlyph';

/**
 * The floating tab bar with its sliding bubble (styles in styles/bottom-nav.css; motion and drag in
 * `useBottomNav`). The main app's bar (`AppBottomNav`) and the patient diary's are this one
 * component: each passes its tabs, labels and badges.
 */
export function BottomNav<V extends string>(props: {
  readonly view: Accessor<V>;
  readonly items: Accessor<readonly NavItem<V>[]>;
  readonly label: string;
  /** The tab's accessible name when it says more than the label (a count, an update). */
  readonly itemLabel?: (item: NavItem<V>) => string;
  /** Badges drawn on a tab. */
  readonly badges?: (item: NavItem<V>) => JSX.Element;
  /** `data-tour` of the bar; tabs get `<tour>-<id>` (the main app's onboarding tour). */
  readonly tour?: string;
  readonly dragIndex: Accessor<number | undefined>;
  readonly dragging: Accessor<boolean>;
  readonly pressed: Accessor<boolean>;
  readonly bubbleStyle: () => string;
  readonly bindNav: (element: HTMLElement) => void;
  readonly onPrefetch?: (next: V) => void;
  readonly onPointerDown: (event: PointerEvent) => void;
  readonly onPointerMove: (event: PointerEvent) => void;
  readonly onPointerUp: (event: PointerEvent) => void;
  readonly onPointerCancel: (event: PointerEvent) => void;
  readonly onItemClick: (next: V) => void;
}): JSX.Element {
  return (
    <nav
      ref={(element) => {
        props.bindNav(element);
        onCleanup(watchNavCrowding(element));
      }}
      class="app-bottom-nav"
      data-tour={props.tour}
      classList={{
        'app-bottom-nav--dragging': props.dragging(),
        'app-bottom-nav--pressed': props.pressed(),
      }}
      aria-label={props.label}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
    >
      <span class="app-bottom-nav__bubble" style={props.bubbleStyle()} aria-hidden="true" />
      <For each={props.items()}>
        {(item, index) => {
          const selected = () =>
            (props.dragIndex() ?? props.items().findIndex((entry) => entry.id === props.view())) ===
            index();
          const label = () => props.itemLabel?.(item) ?? item.label;
          return (
            <div class="app-nav-item">
              <button
                class="app-nav-button"
                data-tour={props.tour ? `${props.tour}-${item.id}` : undefined}
                classList={{ 'app-nav-button--active': selected() }}
                type="button"
                aria-label={label()}
                aria-current={props.view() === item.id ? 'page' : undefined}
                title={label()}
                onPointerEnter={() => props.onPrefetch?.(item.id)}
                onPointerDown={() => props.onPrefetch?.(item.id)}
                onClick={() => props.onItemClick(item.id)}
              >
                <AppGlyph
                  name={item.icon}
                  class={`app-nav-button__icon${selected() ? ' app-nav-button__icon--active' : ''}`}
                />
                {props.badges?.(item)}
              </button>
            </div>
          );
        }}
      </For>
    </nav>
  );
}
