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
import { useStickySurface } from '@/components/sticky-surface';
import { NewsItemRow } from '@/features/news/NewsItemRow';
import { NewsSourceTile } from '@/features/news/NewsSourceTile';
import { NewsSuggestedFeeds } from '@/features/news/NewsSuggestedFeeds';
import {
  NEWS_ADD_HASH,
  NEWS_PUBMED_HASH,
  NEWS_SOURCES_HASH,
  newsSiteHash,
} from '@/features/news/news-routing';
import type { NewsSnapshot } from '@/features/news/news-service';
import { fetchedAtLabel, groupItemsByDay, pluralRu } from '@/features/news/news-state';
import { getNewsService } from '@/features/news/news-store';
import { hasItems, type Subscription } from '@/features/news/news-types';
import { hostLabel } from '@/features/news/source-url';

const ALL_SOURCES = 'all';

/** Survives leaving the list for the viewer and coming back. */
const [selectedFilter, setSelectedFilter] = createSignal<string>(ALL_SOURCES);

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

function NewsEmpty(props: { readonly subscriptions: readonly Subscription[] }): JSX.Element {
  return (
    <div class="news-empty" data-testid="news-empty">
      <p class="news-empty__lead">
        Выберите источники — новое будет собираться здесь. Пока ничего не добавлено, приложение не
        обращается к сети.
      </p>
      <a class="news-pubmed-card" href={NEWS_PUBMED_HASH} data-testid="news-pubmed-entry">
        <NewsSourceTile glyph="search" />
        <span class="news-pubmed-card__copy">
          <span class="news-pubmed-card__title">Поиск в PubMed</span>
          <span class="news-pubmed-card__text">
            Свежие статьи по вашей теме из базы NCBI; поиск можно сохранить как источник.
          </span>
        </span>
        <AppGlyph name="caret-right" class="news-pubmed-card__chevron" />
      </a>
      <NewsSuggestedFeeds subscriptions={props.subscriptions} />
    </div>
  );
}

export function NewsListPage(props: { readonly snapshot: Accessor<NewsSnapshot> }): JSX.Element {
  const service = getNewsService();
  const online = useOnline();
  const selected = selectedFilter;
  const setSelected = setSelectedFilter;
  const [toolbar, setToolbar] = createSignal<HTMLElement>();
  useStickySurface(toolbar);

  const subscriptions = () => props.snapshot().subscriptions;
  // Feeds and saved PubMed searches both produce items.
  const feeds = createMemo(() => subscriptions().filter((entry) => hasItems(entry.kind)));
  const sites = createMemo(() => subscriptions().filter((entry) => entry.kind === 'site'));
  const subscriptionById = createMemo(
    () => new Map(subscriptions().map((entry) => [entry.id, entry])),
  );
  const activeFilter = () =>
    selected() === ALL_SOURCES || feeds().some((entry) => entry.id === selected())
      ? selected()
      : ALL_SOURCES;
  const visibleItems = createMemo(() => {
    const filter = activeFilter();
    const items = props.snapshot().items;
    return filter === ALL_SOURCES ? items : items.filter((item) => item.feedId === filter);
  });
  const groups = createMemo(() => groupItemsByDay(visibleItems(), Date.now()));
  const refreshing = () => props.snapshot().refreshing.size > 0;
  const failing = createMemo(() => feeds().filter((entry) => entry.error));
  const lastFetched = createMemo(() => {
    const times = feeds()
      .map((entry) => entry.fetchedAt)
      .filter((time): time is number => time !== undefined);
    return times.length > 0 ? Math.max(...times) : undefined;
  });
  const unreadFor = (filter: string): number =>
    filter === ALL_SOURCES
      ? props.snapshot().unread
      : (subscriptionById().get(filter)?.unread ?? 0);

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

  const sourceCount = () => subscriptions().length;
  return (
    <section class="news-page page-surface page-grain" data-testid="news-page">
      <Page
        class="news-page__heading"
        icon={<AppGlyph name="newspaper" class="page__icon-glyph" />}
        title={<h1 class="news-page__title">Лента</h1>}
        description={
          sourceCount() === 0
            ? undefined
            : `${sourceCount()} ${pluralRu(sourceCount(), 'источник', 'источника', 'источников')} · обновлено ${fetchedAtLabel(lastFetched(), Date.now())}`
        }
        actions={
          <div class="news-page__actions">
            <Show when={feeds().length > 0}>
              <button
                type="button"
                class="news-page__action"
                aria-label="Обновить ленту"
                title="Обновить ленту"
                disabled={refreshing()}
                onClick={() => void refresh()}
              >
                <AppGlyph
                  name="refresh"
                  class={`news-page__action-icon${refreshing() ? ' news-page__action-icon--spinning' : ''}`}
                />
              </button>
            </Show>
            <a
              class="news-page__action"
              href={NEWS_PUBMED_HASH}
              aria-label="Поиск в PubMed"
              title="Поиск в PubMed"
            >
              <AppGlyph name="search" class="news-page__action-icon" />
            </a>
            <Show when={subscriptions().length > 0}>
              <a
                class="news-page__action"
                href={NEWS_SOURCES_HASH}
                aria-label="Управление источниками"
                title="Источники"
              >
                <AppGlyph name="sliders-horizontal" class="news-page__action-icon" />
              </a>
            </Show>
            <a
              class="news-page__action news-page__action--add"
              href={NEWS_ADD_HASH}
              aria-label="Добавить источник"
              title="Добавить источник"
              data-testid="news-add-entry"
            >
              <AppGlyph name="plus" class="news-page__action-icon" />
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

      <Switch>
        <Match when={subscriptions().length === 0}>
          <NewsEmpty subscriptions={subscriptions()} />
        </Match>
        <Match when={true}>
          <Show when={sites().length > 0}>
            <section class="news-sites" aria-label="Сайты">
              <h2 class="news-sites__heading">Сайты</h2>
              <ul class="news-sites__list">
                <For each={sites()}>
                  {(site) => (
                    <li class="news-sites__item">
                      <a
                        class="news-sites__link"
                        href={newsSiteHash(site.id)}
                        data-news-site={site.id}
                      >
                        <AppGlyph name="globe" class="news-sites__icon" />
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
            </section>
          </Show>
          <Show when={feeds().length > 0}>
            <div
              ref={setToolbar}
              class="news-toolbar knowledge-subroute-heading--blurred route-sticky-chrome route-sticky-chrome--transparent"
            >
              <nav
                class="news-toolbar__chips knowledge-subroute-heading__control"
                aria-label="Источники"
              >
                <button
                  type="button"
                  class="news-chip"
                  classList={{ 'news-chip--active': activeFilter() === ALL_SOURCES }}
                  aria-pressed={activeFilter() === ALL_SOURCES}
                  onClick={() => setSelected(ALL_SOURCES)}
                >
                  <span class="news-chip__label">Все</span>
                  <Show when={unreadFor(ALL_SOURCES) > 0}>
                    <span class="news-chip__count">{unreadFor(ALL_SOURCES)}</span>
                  </Show>
                </button>
                <For each={feeds()}>
                  {(entry) => (
                    <button
                      type="button"
                      class="news-chip"
                      classList={{ 'news-chip--active': activeFilter() === entry.id }}
                      aria-pressed={activeFilter() === entry.id}
                      data-news-chip={entry.id}
                      onClick={() => setSelected(entry.id)}
                    >
                      <span class="news-chip__label">{entry.title}</span>
                      <Show when={entry.unread > 0}>
                        <span class="news-chip__count">{entry.unread}</span>
                      </Show>
                    </button>
                  )}
                </For>
              </nav>
            </div>
            <Show when={unreadFor(activeFilter()) > 0}>
              <button
                type="button"
                class="news-page__mark-read"
                onClick={() =>
                  void service.markAllRead(
                    activeFilter() === ALL_SOURCES ? undefined : activeFilter(),
                  )
                }
              >
                <AppGlyph name="check" class="news-page__mark-read-icon" />
                Отметить всё прочитанным
              </button>
            </Show>
            <Show
              when={groups().length > 0}
              fallback={
                <p class="news-page__empty" role="status">
                  {refreshing()
                    ? 'Загружаем записи…'
                    : 'Записей пока нет. Нажмите «Обновить», когда появится сеть.'}
                </p>
              }
            >
              <For each={groups()}>
                {(group) => (
                  <section class="news-day" aria-labelledby={`news-day-${group.key}`}>
                    <h2 class="news-day__title" id={`news-day-${group.key}`}>
                      {group.label}
                    </h2>
                    <ul class="news-day__list">
                      <For each={group.items}>
                        {(item) => (
                          <NewsItemRow
                            item={item}
                            subscription={subscriptionById().get(item.feedId)}
                          />
                        )}
                      </For>
                    </ul>
                  </section>
                )}
              </For>
            </Show>
          </Show>
          <Show
            when={feeds().length === 0 && sites().length > 0}
            fallback={<NewsSuggestedFeeds subscriptions={subscriptions()} variant="compact" />}
          >
            <NewsSuggestedFeeds subscriptions={subscriptions()} />
          </Show>
        </Match>
      </Switch>
    </section>
  );
}
