import { type JSX, Show } from 'solid-js';

import { itemTimeLabel } from '@/features/news/news-format';
import { newsItemHash } from '@/features/news/news-routing';
import type { NewsItem, Subscription } from '@/features/news/news-types';

export function NewsItemRow(props: {
  readonly item: NewsItem;
  readonly subscription: Subscription | undefined;
}): JSX.Element {
  const thumbnail = () => (props.subscription?.images ? props.item.imageUrl : undefined);
  return (
    <li class="news-item">
      <a
        class="news-item__link"
        href={newsItemHash(props.item.id)}
        data-news-item={props.item.id}
        data-read={props.item.read ? 'true' : 'false'}
      >
        <span class="news-item__marker" aria-hidden="true">
          <Show when={!props.item.read}>
            <span class="news-item__dot" />
          </Show>
        </span>
        <span class="news-item__body">
          <span class="news-item__meta">
            <span class="news-item__source">{props.subscription?.title ?? 'Источник удалён'}</span>
            <span class="news-item__time">{itemTimeLabel(props.item.publishedAt)}</span>
            <Show when={!props.item.read}>
              <span class="sr-only">не прочитано</span>
            </Show>
          </span>
          <span
            class="news-item__title"
            classList={{ 'news-item__title--unread': !props.item.read }}
          >
            {props.item.title}
          </span>
          <Show when={props.item.snippet}>
            <span class="news-item__snippet">{props.item.snippet}</span>
          </Show>
        </span>
        <Show when={thumbnail()}>
          {(src) => (
            <img
              class="news-item__thumbnail"
              src={src()}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
            />
          )}
        </Show>
      </a>
    </li>
  );
}
