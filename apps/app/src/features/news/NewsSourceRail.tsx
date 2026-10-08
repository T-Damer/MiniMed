import { For, type JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { NewsAvatar } from '@/features/news/NewsAvatar';
import { avatarLook } from '@/features/news/news-avatar';
import { NEWS_ADD_HASH } from '@/features/news/news-routing';
import type { Subscription } from '@/features/news/news-types';
import { type SuggestedFeed, unsubscribedSuggestions } from '@/features/news/suggested-feeds';

/**
 * The strip of sources not yet subscribed to, above the feed: one swipeable row of cards, led by a
 * «+» card for an address of one's own. Tapping a card opens that source's sheet; the cards are
 * drawn from bundled data, so looking at them sends nothing.
 */
export function NewsSourceRail(props: {
  readonly subscriptions: readonly Subscription[];
  readonly icons: Readonly<Record<string, string>>;
  /** `avatar` is the card's avatar element, the start of the View Transition. */
  readonly onOpen: (feed: SuggestedFeed, avatar: HTMLElement | undefined) => void;
}): JSX.Element {
  const remaining = () =>
    unsubscribedSuggestions(new Set(props.subscriptions.map((entry) => entry.url)));
  return (
    <ul class="news-rail" aria-label="Новые источники" data-testid="news-rail">
      <li class="news-rail__item">
        <a
          class="news-rail__card news-rail__card--add"
          href={NEWS_ADD_HASH}
          aria-label="Добавить свой источник"
          data-testid="news-add-entry"
        >
          <span class="news-rail__plus">
            <AppGlyph name="plus" class="news-rail__plus-icon" />
          </span>
          <span class="news-rail__name">Свой источник</span>
        </a>
      </li>
      <For each={remaining()}>
        {(feed) => (
          <li class="news-rail__item" data-suggested={feed.id}>
            <button
              type="button"
              class="news-rail__card"
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
              <span class="news-rail__name">{feed.title}</span>
              <span class="news-rail__topic">{feed.topic}</span>
            </button>
          </li>
        )}
      </For>
    </ul>
  );
}
