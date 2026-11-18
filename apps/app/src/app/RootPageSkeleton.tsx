import { For, type JSX } from 'solid-js';

import { ROOT_VIEWS, type RootView } from '@/app/root-view';

import '@/app/root-page-skeleton.css';

const layouts = {
  search: { layout: 'search', entries: 4 },
  modules: { layout: 'tiles', entries: 6 },
  assessments: { layout: 'list', entries: 5 },
  calculators: { layout: 'tiles', entries: 4 },
  notes: { layout: 'tiles', entries: 3 },
  news: { layout: 'feed', entries: 3 },
  settings: { layout: 'list', entries: 4 },
} as const satisfies Record<RootView, { layout: string; entries: number }>;

/** Mirrors the visible structure of each tab while its route bundle loads. */
export function RootPageSkeleton(props: { readonly view: RootView }): JSX.Element {
  const config = () => layouts[props.view];
  return (
    <div
      class="root-page-skeleton"
      classList={{ 'root-page-skeleton--news': props.view === 'news' }}
      role="status"
      aria-label={`${ROOT_VIEWS.find((view) => view.id === props.view)?.label} · Загрузка`}
      aria-busy="true"
    >
      <div
        class={`root-page-skeleton__header root-page-skeleton__header--${config().layout}`}
        aria-hidden="true"
      />
      <div
        class={`root-page-skeleton__entries root-page-skeleton__entries--${config().layout}`}
        aria-hidden="true"
      >
        <For each={Array.from({ length: config().entries })}>
          {() => (
            <div class={`root-page-skeleton__entry root-page-skeleton__entry--${config().layout}`}>
              <span class="root-page-skeleton__line root-page-skeleton__line--title" />
              <span class="root-page-skeleton__line root-page-skeleton__line--detail" />
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
