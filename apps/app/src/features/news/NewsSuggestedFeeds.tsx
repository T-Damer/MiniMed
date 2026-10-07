import { type Accessor, createSignal, For, type JSX, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { NewsSourceTile } from '@/features/news/NewsSourceTile';
import { getNewsService } from '@/features/news/news-store';
import type { Subscription } from '@/features/news/news-types';
import {
  LANGUAGE_LABELS,
  SUGGESTED_FEED_GROUPS,
  SUGGESTED_FEEDS,
  type SuggestedFeed,
  unsubscribedSuggestions,
} from '@/features/news/suggested-feeds';

/** One-tap subscribing to a suggested source; shared by the card list and the compact rail. */
function useSuggestedSubscribe(onSubscribed?: (subscription: Subscription) => void): {
  readonly busyId: Accessor<string | undefined>;
  readonly subscribe: (feed: SuggestedFeed) => void;
} {
  const service = getNewsService();
  const [busyId, setBusyId] = createSignal<string>();
  const subscribe = async (feed: SuggestedFeed): Promise<void> => {
    setBusyId(feed.id);
    try {
      // Sources measured to carry pictures start with «Изображения» on (ADR-0024); it stays a
      // per-source switch on the sources page.
      const subscription = await service.subscribeFeed(feed.url, {
        title: feed.title,
        language: feed.language,
        suggestedId: feed.id,
        images: feed.carriesImages,
      });
      toast.success(`Источник добавлен: ${feed.title}`);
      onSubscribed?.(subscription);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось добавить источник.';
      toast.error(`${feed.title}: ${message}`);
    } finally {
      setBusyId(undefined);
    }
  };
  return { busyId, subscribe: (feed) => void subscribe(feed) };
}

function SuggestedCard(props: {
  readonly feed: SuggestedFeed;
  readonly subscribed: boolean;
  readonly busy: boolean;
  readonly webLimited: boolean;
  readonly onSubscribe: (feed: SuggestedFeed) => void;
}): JSX.Element {
  return (
    <li class="news-suggested__item" data-suggested={props.feed.id}>
      <NewsSourceTile visual={props.feed.visual} glyph="rss" />
      <span class="news-suggested__copy">
        <span class="news-suggested__title">
          {props.feed.title}
          <span class="news-suggested__language">{LANGUAGE_LABELS[props.feed.language]}</span>
        </span>
        <span class="news-suggested__description">{props.feed.description}</span>
        <span class="news-suggested__tags">
          <span class="news-suggested__tag">
            <AppGlyph name={props.feed.visual.glyph} class="news-suggested__tag-icon" />
            {props.feed.topic}
          </span>
          <Show when={props.feed.carriesImages}>
            <span class="news-suggested__tag">
              <AppGlyph name="image" class="news-suggested__tag-icon" />С картинками
            </span>
          </Show>
        </span>
        <Show when={props.webLimited && !props.feed.webReadable}>
          <span class="news-suggested__note">
            В браузере может не открыться; в приложении для Android работает.
          </span>
        </Show>
      </span>
      <Button
        variant={props.subscribed ? 'secondary' : 'primary'}
        class="news-suggested__action"
        disabled={props.subscribed || props.busy}
        aria-label={`${props.subscribed ? 'Подписка оформлена' : 'Подписаться'}: ${props.feed.title}`}
        icon={<AppGlyph name={props.subscribed ? 'check' : 'plus'} />}
        onClick={() => props.onSubscribe(props.feed)}
      >
        {props.subscribed ? 'Добавлено' : props.busy ? 'Добавляем…' : 'Подписаться'}
      </Button>
    </li>
  );
}

function SuggestedChip(props: {
  readonly feed: SuggestedFeed;
  readonly busy: boolean;
  readonly onSubscribe: (feed: SuggestedFeed) => void;
}): JSX.Element {
  return (
    <li class="news-suggested__chip" data-suggested={props.feed.id}>
      <span class="news-suggested__chip-head">
        <NewsSourceTile visual={props.feed.visual} glyph="rss" size="small" />
        <Button
          variant="primary"
          class="news-suggested__chip-action"
          disabled={props.busy}
          aria-label={`Подписаться: ${props.feed.title}`}
          title="Подписаться"
          icon={<AppGlyph name={props.busy ? 'refresh' : 'plus'} />}
          onClick={() => props.onSubscribe(props.feed)}
        />
      </span>
      <span class="news-suggested__chip-title">{props.feed.title}</span>
      <span class="news-suggested__chip-topic">{props.feed.topic}</span>
    </li>
  );
}

/**
 * The curated list (data, not interface code): offered, never subscribed to on its own, and drawn
 * from bundled visuals so that looking at it sends nothing. `cards` is the full first view;
 * `compact` is a one-row rail of the sources not yet subscribed to.
 */
export function NewsSuggestedFeeds(props: {
  readonly subscriptions: readonly Subscription[];
  readonly variant?: 'cards' | 'compact';
  readonly onSubscribed?: (subscription: Subscription) => void;
}): JSX.Element {
  const service = getNewsService();
  const { busyId, subscribe } = useSuggestedSubscribe(props.onSubscribed);
  const subscribedUrls = () => new Set(props.subscriptions.map((entry) => entry.url));
  const webLimited = service.transportKind === 'web';
  const remaining = () => unsubscribedSuggestions(subscribedUrls());

  return (
    <Show
      when={props.variant === 'compact'}
      fallback={
        <section class="news-suggested" aria-labelledby="news-suggested-title">
          <h2 class="news-suggested__heading" id="news-suggested-title">
            Рекомендуемые источники
          </h2>
          <p class="news-suggested__intro">
            Запросы к источнику начинаются только после нажатия «Подписаться».
          </p>
          <For each={SUGGESTED_FEED_GROUPS}>
            {(group) => (
              <div class="news-suggested__group">
                <h3 class="news-suggested__group-title">{group.title}</h3>
                <ul class="news-suggested__list">
                  <For each={SUGGESTED_FEEDS.filter((feed) => feed.group === group.id)}>
                    {(feed) => (
                      <SuggestedCard
                        feed={feed}
                        subscribed={subscribedUrls().has(feed.url)}
                        busy={busyId() === feed.id}
                        webLimited={webLimited}
                        onSubscribe={subscribe}
                      />
                    )}
                  </For>
                </ul>
              </div>
            )}
          </For>
        </section>
      }
    >
      <Show when={remaining().length > 0}>
        <section
          class="news-suggested news-suggested--compact"
          aria-labelledby="news-suggested-title"
          data-testid="news-suggested-compact"
        >
          <h2
            class="news-suggested__heading news-suggested__heading--compact"
            id="news-suggested-title"
          >
            Ещё источники
          </h2>
          <ul class="news-suggested__rail">
            <For each={remaining()}>
              {(feed) => (
                <SuggestedChip feed={feed} busy={busyId() === feed.id} onSubscribe={subscribe} />
              )}
            </For>
          </ul>
        </section>
      </Show>
    </Show>
  );
}
