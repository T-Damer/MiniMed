import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { NewsAvatar } from '@/features/news/NewsAvatar';
import { avatarLook } from '@/features/news/news-avatar';
import { NEWS_ADD_HASH } from '@/features/news/news-routing';
import type { Subscription } from '@/features/news/news-types';
import {
  LANGUAGE_LABELS,
  type SuggestedFeed,
  unsubscribedSuggestions,
} from '@/features/news/suggested-feeds';

/**
 * The empty «Лента»: every suggested source as a tile, two to a row on a phone, so a first visit has
 * something to tap. The tile opens the source's sheet (description, latest items, «Подписаться»); the
 * small «+» on it subscribes in one tap. Neither is automatic: nothing is requested, and nothing is
 * subscribed, until the user taps (ADR-0024). The tiles are drawn from bundled data.
 */
export function NewsSourceGrid(props: {
  readonly subscriptions: readonly Subscription[];
  readonly icons: Readonly<Record<string, string>>;
  /** `avatar` is the tile's avatar element, the start of the View Transition. */
  readonly onOpen: (feed: SuggestedFeed, avatar: HTMLElement | undefined) => void;
  /** One-tap subscription; rejects with the reason shown to the user. Absent: no «+» on the tiles. */
  readonly onSubscribe?: ((feed: SuggestedFeed) => Promise<void>) | undefined;
  /** Whether a source can be subscribed to from here (the browser build reads only some feeds). */
  readonly canSubscribe?: ((feed: SuggestedFeed) => boolean) | undefined;
  /** Which sources get a tile at all: the browser build hides those it cannot read. */
  readonly shows?: ((feed: SuggestedFeed) => boolean) | undefined;
}): JSX.Element {
  const remaining = () =>
    unsubscribedSuggestions(new Set(props.subscriptions.map((entry) => entry.url))).filter(
      (feed) => props.shows?.(feed) ?? true,
    );
  const [busy, setBusy] = createSignal<ReadonlySet<string>>(new Set());

  const subscribe = async (feed: SuggestedFeed): Promise<void> => {
    if (!props.onSubscribe || busy().has(feed.id)) return;
    setBusy((current) => new Set(current).add(feed.id));
    try {
      await props.onSubscribe(feed);
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(feed.id);
        return next;
      });
    }
  };

  return (
    <ul class="news-grid" aria-label="Источники для ленты" data-testid="news-source-grid">
      <li class="news-grid__item">
        <a
          class="news-grid__tile news-grid__tile--add"
          href={NEWS_ADD_HASH}
          aria-label="Добавить свой источник"
          data-testid="news-add-entry"
        >
          <span class="news-grid__plus">
            <AppGlyph name="plus" class="news-grid__plus-icon" />
          </span>
          <span class="news-grid__name">Свой источник</span>
        </a>
      </li>
      <For each={remaining()}>
        {(feed) => (
          <li class="news-grid__item" data-suggested={feed.id}>
            <button
              type="button"
              class="news-grid__tile"
              aria-label={feed.title}
              onClick={(event) =>
                props.onOpen(
                  feed,
                  event.currentTarget.querySelector<HTMLElement>('.news-avatar') ?? undefined,
                )
              }
            >
              <NewsAvatar
                size="md"
                look={avatarLook(feed.title, feed.siteUrl, props.icons, feed.id)}
              />
              <span class="news-grid__name">{feed.title}</span>
              <span class="news-grid__topic">
                {LANGUAGE_LABELS[feed.language] ?? feed.language.toUpperCase()} · {feed.topic}
              </span>
            </button>
            <Show when={props.onSubscribe && (props.canSubscribe?.(feed) ?? true)}>
              <button
                type="button"
                class="news-grid__subscribe"
                aria-label={`Подписаться: ${feed.title}`}
                title="Подписаться"
                data-testid="news-quick-subscribe"
                aria-busy={busy().has(feed.id)}
                disabled={busy().has(feed.id)}
                onClick={() => void subscribe(feed)}
              >
                <AppGlyph
                  name={busy().has(feed.id) ? 'refresh' : 'plus'}
                  class={`news-grid__subscribe-icon${busy().has(feed.id) ? ' news-grid__subscribe-icon--spinning' : ''}`}
                />
              </button>
            </Show>
          </li>
        )}
      </For>
    </ul>
  );
}
