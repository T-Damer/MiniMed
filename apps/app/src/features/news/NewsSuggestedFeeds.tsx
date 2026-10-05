import { createSignal, For, type JSX, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { getNewsService } from '@/features/news/news-store';
import type { Subscription } from '@/features/news/news-types';
import {
  LANGUAGE_LABELS,
  SUGGESTED_FEED_GROUPS,
  SUGGESTED_FEEDS,
  type SuggestedFeed,
} from '@/features/news/suggested-feeds';

function SuggestedFeedRow(props: {
  readonly feed: SuggestedFeed;
  readonly subscribed: boolean;
  readonly busy: boolean;
  readonly webLimited: boolean;
  readonly onSubscribe: (feed: SuggestedFeed) => void;
}): JSX.Element {
  return (
    <li class="news-suggested__item" data-suggested={props.feed.id}>
      <span class="news-suggested__copy">
        <span class="news-suggested__title">
          {props.feed.title}
          <span class="news-suggested__language">{LANGUAGE_LABELS[props.feed.language]}</span>
        </span>
        <span class="news-suggested__description">{props.feed.description}</span>
        <Show when={props.webLimited && !props.feed.webReadable}>
          <span class="news-suggested__note">
            В браузере может не открыться (источник не разрешает чтение из страницы); в приложении
            для Android работает.
          </span>
        </Show>
      </span>
      <button
        type="button"
        class="news-suggested__action"
        classList={{ 'news-suggested__action--done': props.subscribed }}
        disabled={props.subscribed || props.busy}
        aria-label={`${props.subscribed ? 'Подписка оформлена' : 'Подписаться'}: ${props.feed.title}`}
        onClick={() => props.onSubscribe(props.feed)}
      >
        <AppGlyph name={props.subscribed ? 'check' : 'plus'} class="news-suggested__action-icon" />
        {props.subscribed ? 'Добавлено' : props.busy ? 'Добавляем…' : 'Подписаться'}
      </button>
    </li>
  );
}

/** The curated list (data, not interface code): offered, never subscribed to on its own. */
export function NewsSuggestedFeeds(props: {
  readonly subscriptions: readonly Subscription[];
  readonly onSubscribed?: (subscription: Subscription) => void;
}): JSX.Element {
  const service = getNewsService();
  const [busyId, setBusyId] = createSignal<string>();
  const subscribedUrls = () => new Set(props.subscriptions.map((entry) => entry.url));
  const webLimited = service.transportKind === 'web';

  const subscribe = async (feed: SuggestedFeed): Promise<void> => {
    setBusyId(feed.id);
    try {
      const subscription = await service.subscribeFeed(feed.url, {
        title: feed.title,
        language: feed.language,
        suggestedId: feed.id,
      });
      toast.success(`Источник добавлен: ${feed.title}`);
      props.onSubscribed?.(subscription);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось добавить источник.';
      toast.error(`${feed.title}: ${message}`);
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <section class="news-suggested" aria-labelledby="news-suggested-title">
      <h2 class="news-suggested__heading" id="news-suggested-title">
        Рекомендуемые источники
      </h2>
      <p class="news-suggested__intro">
        Подборка открытых медицинских лент. Ничего не подключается само: запросы к источнику
        начинаются после нажатия «Подписаться».
      </p>
      <For each={SUGGESTED_FEED_GROUPS}>
        {(group) => (
          <div class="news-suggested__group">
            <h3 class="news-suggested__group-title">{group.title}</h3>
            <ul class="news-suggested__list">
              <For each={SUGGESTED_FEEDS.filter((feed) => feed.group === group.id)}>
                {(feed) => (
                  <SuggestedFeedRow
                    feed={feed}
                    subscribed={subscribedUrls().has(feed.url)}
                    busy={busyId() === feed.id}
                    webLimited={webLimited}
                    onSubscribe={(entry) => void subscribe(entry)}
                  />
                )}
              </For>
            </ul>
          </div>
        )}
      </For>
    </section>
  );
}
