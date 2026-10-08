import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Page } from '@/components/Page';
import { NewsAvatar } from '@/features/news/NewsAvatar';
import { NewsItemRow } from '@/features/news/NewsItemRow';
import { NewsSourceRail } from '@/features/news/NewsSourceRail';
import { NewsSourceSheet, type SourceTarget } from '@/features/news/NewsSourceSheet';
import { avatarLookOf } from '@/features/news/news-avatar';
import {
  createPassedObserver,
  createReadTracker,
  type PassedObserver,
} from '@/features/news/news-read-tracker';
import { NEWS_PUBMED_HASH, NEWS_SOURCES_HASH, newsSiteHash } from '@/features/news/news-routing';
import type { NewsSnapshot } from '@/features/news/news-service';
import { fetchedAtLabel, pluralRu, sortNewestFirst } from '@/features/news/news-state';
import { getNewsService } from '@/features/news/news-store';
import { BROWSER_FEEDS_MESSAGE, feedsNeedNativeApp } from '@/features/news/news-transport';
import { hasItems, type Subscription } from '@/features/news/news-types';
import { openThroughAvatarTransition } from '@/features/news/news-view-transition';
import { hostLabel } from '@/features/news/source-url';

/** Entries drawn at first, and added each time the end of the list comes near. */
const PAGE_SIZE = 60;
/** Survives leaving the list for the viewer and coming back, so the scroll position can be restored. */
const [renderLimit, setRenderLimit] = createSignal(PAGE_SIZE);

function useOnline(): Accessor<boolean> {
  const [online, setOnline] = createSignal(navigator.onLine);
  onMount(() => {
    const update = (): void => {
      setOnline(navigator.onLine);
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    onCleanup(() => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    });
  });
  return online;
}

/** A clock for the relative times; one tick a minute is all a «5 мин» needs. */
function useMinuteClock(): Accessor<number> {
  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    onCleanup(() => window.clearInterval(timer));
  });
  return now;
}

export function NewsListPage(props: { readonly snapshot: Accessor<NewsSnapshot> }): JSX.Element {
  const service = getNewsService();
  const online = useOnline();
  const now = useMinuteClock();
  const [sheetTarget, setSheetTarget] = createSignal<SourceTarget>();

  const subscriptions = () => props.snapshot().subscriptions;
  // Feeds and saved PubMed searches both produce items.
  const feeds = createMemo(() => subscriptions().filter((entry) => hasItems(entry.kind)));
  const sites = createMemo(() => subscriptions().filter((entry) => entry.kind === 'site'));
  const subscriptionById = createMemo(
    () => new Map(subscriptions().map((entry) => [entry.id, entry])),
  );
  const icons = () => props.snapshot().icons;
  const items = createMemo(() => sortNewestFirst(props.snapshot().items));
  const visibleItems = createMemo(() => items().slice(0, renderLimit()));
  const refreshing = () => props.snapshot().refreshing.size > 0;
  const failing = createMemo(() => feeds().filter((entry) => entry.error));
  const lastFetched = createMemo(() => {
    const times = feeds()
      .map((entry) => entry.fetchedAt)
      .filter((time): time is number => time !== undefined);
    return times.length > 0 ? Math.max(...times) : undefined;
  });

  // Scrolling past an entry marks it read; the writes are batched.
  const tracker = createReadTracker((ids) => void service.markReadMany(ids));
  // Created while the component runs, not in onMount: rows already in the cache render (and call
  // their refs) before onMount, and would otherwise never be watched.
  const hasObserver = typeof IntersectionObserver !== 'undefined';
  const passed: PassedObserver | undefined = hasObserver
    ? createPassedObserver((id) => tracker.track(id))
    : undefined;
  const more: IntersectionObserver | undefined = hasObserver
    ? new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          if (renderLimit() < items().length) setRenderLimit((limit) => limit + PAGE_SIZE);
        },
        { rootMargin: '800px 0px' },
      )
    : undefined;
  onMount(() => {
    const flushWhenHidden = (): void => {
      if (document.visibilityState === 'hidden') tracker.flush();
    };
    document.addEventListener('visibilitychange', flushWhenHidden);
    onCleanup(() => document.removeEventListener('visibilitychange', flushWhenHidden));
  });
  onCleanup(() => {
    passed?.disconnect();
    more?.disconnect();
    tracker.dispose();
  });

  const refresh = async (): Promise<void> => {
    const report = await service.refresh();
    if (report.offline) toast.info('Нет сети: показаны сохранённые записи.');
    else if (report.failed > 0 && report.refreshed === 0) {
      toast.error('Не удалось обновить ленту.');
    } else if (report.added > 0) {
      toast.success(`Новых записей: ${report.added}`);
    } else {
      toast.success('Новых записей нет.');
    }
  };

  const openSource = (feed: SourceTarget & { kind: 'suggested' }, avatar?: HTMLElement): void => {
    openThroughAvatarTransition(avatar, () => setSheetTarget(feed));
  };

  const sourceCount = () => subscriptions().length;
  return (
    <section class="news-page page-surface page-grain" data-testid="news-page">
      <Page
        class="news-page__heading"
        title={
          <span class="news-page__brand">
            <AppGlyph name="newspaper" class="news-page__brand-icon" />
            <h1 class="news-page__title">Лента</h1>
          </span>
        }
        description={
          sourceCount() === 0
            ? undefined
            : `${sourceCount()} ${pluralRu(sourceCount(), 'источник', 'источника', 'источников')} · обновлено ${fetchedAtLabel(lastFetched(), Date.now())}`
        }
        help={
          <>
            <p>
              Лента собирает новости из источников, которые вы выбрали. Запросы уходят только к этим
              сайтам: когда вы открываете ленту (не чаще раза в 15 минут) и когда нажимаете
              «Обновить».
            </p>
            <p>
              Запись становится прочитанной, когда вы пролистали её. Статьи сохраняются на
              устройстве и читаются без сети.
            </p>
          </>
        }
        actions={
          <div class="news-page__actions">
            <a
              class="news-icon-button news-icon-button--pill"
              href={NEWS_PUBMED_HASH}
              aria-label="Поиск в PubMed"
              title="Поиск в PubMed"
              data-testid="news-pubmed-entry"
            >
              <AppGlyph name="search" class="news-icon-button__icon" />
              PubMed
            </a>
            <Show when={feeds().length > 0}>
              <button
                type="button"
                class="news-icon-button"
                aria-label="Обновить ленту"
                title="Обновить ленту"
                disabled={refreshing()}
                onClick={() => void refresh()}
              >
                <AppGlyph
                  name="refresh"
                  class={`news-icon-button__icon${refreshing() ? ' news-icon-button__icon--spinning' : ''}`}
                />
              </button>
            </Show>
            <a
              class="news-icon-button"
              href={NEWS_SOURCES_HASH}
              aria-label="Управление источниками"
              title="Источники"
            >
              <AppGlyph name="rss" class="news-icon-button__icon" />
            </a>
          </div>
        }
      />

      <Show when={!online() && feeds().length > 0}>
        <p class="news-page__banner" role="status" data-testid="news-offline">
          <AppGlyph name="info" class="news-page__banner-icon" />
          Нет сети. Показаны сохранённые записи; время последнего обновления —{' '}
          {fetchedAtLabel(lastFetched(), Date.now())}.
        </p>
      </Show>
      <Show when={online() && failing().length > 0}>
        <div
          class="news-page__banner news-page__banner--error"
          role="status"
          data-testid="news-errors"
        >
          <AppGlyph name="info" class="news-page__banner-icon" />
          <div class="news-page__banner-copy">
            <For each={failing()}>
              {(entry) => (
                <p class="news-page__banner-line">
                  <strong class="news-page__banner-source">{entry.title}:</strong>{' '}
                  {entry.error?.message}
                </p>
              )}
            </For>
            <a class="news-page__banner-link" href={NEWS_SOURCES_HASH}>
              Источники
            </a>
          </div>
        </div>
      </Show>

      <Show when={subscriptions().length === 0}>
        <p class="news-empty news-empty--lead" data-testid="news-empty">
          Выберите источник — новое будет появляться здесь.
        </p>
      </Show>
      <NewsSourceRail
        subscriptions={subscriptions()}
        icons={icons()}
        onOpen={(feed, avatar) => openSource({ kind: 'suggested', feed }, avatar)}
      />

      <Switch>
        <Match when={subscriptions().length === 0}>
          <Show when={feedsNeedNativeApp()}>
            <p class="news-page__banner" role="status" data-testid="news-web-hint">
              <AppGlyph name="info" class="news-page__banner-icon" />
              {BROWSER_FEEDS_MESSAGE}
            </p>
          </Show>
        </Match>
        <Match when={true}>
          <Show when={sites().length > 0}>
            <ul class="news-sites" aria-label="Сайты">
              <For each={sites()}>
                {(site) => (
                  <li class="news-sites__item">
                    <a
                      class="news-sites__link"
                      href={newsSiteHash(site.id)}
                      data-news-site={site.id}
                    >
                      <NewsAvatar size="sm" look={avatarLookOf(site, icons())} />
                      <span class="news-sites__copy">
                        <span class="news-sites__title">{site.title}</span>
                        <span class="news-sites__host">{hostLabel(site.url)}</span>
                      </span>
                      <AppGlyph name="caret-right" class="news-sites__chevron" />
                    </a>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Show when={feeds().length > 0}>
            <Show
              when={visibleItems().length > 0}
              fallback={
                <p class="news-page__empty" role="status">
                  {refreshing()
                    ? 'Загружаем записи…'
                    : 'Записей пока нет. Нажмите «Обновить», когда появится сеть.'}
                </p>
              }
            >
              <ul class="news-feed" data-testid="news-feed">
                <For each={visibleItems()}>
                  {(item) => (
                    <NewsItemRow
                      item={item}
                      subscription={subscriptionById().get(item.feedId)}
                      icons={icons()}
                      now={now()}
                      onUnreadRow={(element, id) => passed?.observe(element, id)}
                    />
                  )}
                </For>
              </ul>
              <Show when={renderLimit() < items().length}>
                <div
                  class="news-feed__more"
                  aria-hidden="true"
                  ref={(element) => more?.observe(element)}
                />
              </Show>
            </Show>
          </Show>
        </Match>
      </Switch>

      <NewsSourceSheet
        target={sheetTarget()}
        subscriptions={subscriptions() as readonly Subscription[]}
        icons={icons()}
        onClose={() => setSheetTarget(undefined)}
      />
    </section>
  );
}
