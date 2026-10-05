import {
  createEffect,
  createSignal,
  type JSX,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { NewsAddPage } from '@/features/news/NewsAddPage';
import { NewsListPage } from '@/features/news/NewsListPage';
import { NewsSourcesPage } from '@/features/news/NewsSourcesPage';
import { NewsViewer } from '@/features/news/NewsViewer';
import { isNewsRoute, type NewsRoute, readNewsRoute } from '@/features/news/news-routing';
import { getNewsService, useNewsSnapshot } from '@/features/news/news-store';
import '@/styles/news.css';

/** A feed older than this is refreshed when the tab is opened; a quicker return makes no request. */
export const NEWS_STALE_AFTER_MS = 15 * 60 * 1000;

export interface NewsViewProps {
  readonly active: boolean;
}

/**
 * The «Лента» tab (ADR-0024): the list of cached items, adding and managing sources, and the
 * viewer. Routes are hashes under `#/news`, so Android Back closes the viewer first.
 */
export function NewsView(props: NewsViewProps): JSX.Element {
  const snapshot = useNewsSnapshot();
  const [route, setRoute] = createSignal<NewsRoute>(readNewsRoute());
  let listScroll = 0;

  onMount(() => {
    const sync = (): void => {
      const next = window.location.hash;
      if (!isNewsRoute(next)) return;
      const previous = route();
      const resolved = readNewsRoute(next);
      if (previous.kind === 'list' && resolved.kind !== 'list') listScroll = window.scrollY;
      setRoute(resolved);
      if (resolved.kind === 'list' && previous.kind !== 'list') {
        const top = listScroll;
        requestAnimationFrame(() => window.scrollTo({ top, behavior: 'instant' }));
      } else if (resolved.kind !== previous.kind) {
        window.scrollTo({ top: 0, behavior: 'instant' });
      }
    };
    window.addEventListener('hashchange', sync);
    onCleanup(() => window.removeEventListener('hashchange', sync));
  });

  // Opening the tab refreshes the feeds that have gone stale; with no subscription there is no request.
  createEffect(
    on(
      () => props.active,
      (active) => {
        if (active && route().kind === 'list') {
          void getNewsService().refreshStale(NEWS_STALE_AFTER_MS);
        }
      },
    ),
  );

  return (
    <Switch>
      <Match when={route().kind === 'add'}>
        <NewsAddPage snapshot={snapshot} />
      </Match>
      <Match when={route().kind === 'sources'}>
        <NewsSourcesPage snapshot={snapshot} />
      </Match>
      <Match when={route().kind === 'item' || route().kind === 'site'}>
        <Show when={route()} keyed>
          {(current) =>
            current.kind === 'item' || current.kind === 'site' ? (
              <NewsViewer target={current} snapshot={snapshot} />
            ) : null
          }
        </Show>
      </Match>
      <Match when={true}>
        <NewsListPage snapshot={snapshot} />
      </Match>
    </Switch>
  );
}
