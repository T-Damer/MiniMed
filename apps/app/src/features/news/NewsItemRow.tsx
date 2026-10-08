import { type JSX, Show } from 'solid-js';

import { NewsAvatar } from '@/features/news/NewsAvatar';
import { avatarLookOf } from '@/features/news/news-avatar';
import { relativeTimeLabel } from '@/features/news/news-format';
import { newsItemHash } from '@/features/news/news-routing';
import type { NewsItem, Subscription } from '@/features/news/news-types';
import { hostLabel } from '@/features/news/source-url';

/**
 * One entry of the feed, as compact as a post: a small account line (avatar, name, site, age) and
 * the title, at most six lines. Reading is tracked by scrolling past it, so there is no unread
 * column; an unread entry has a dot after its age and full-strength text.
 */
export function NewsItemRow(props: {
  readonly item: NewsItem;
  readonly subscription: Subscription | undefined;
  readonly icons: Readonly<Record<string, string>>;
  readonly now: number;
  /** Called with the row's element while the entry is unread, to watch it scroll past. */
  readonly onUnreadRow?: ((element: HTMLElement, itemId: string) => void) | undefined;
}): JSX.Element {
  const look = () => {
    const subscription = props.subscription;
    return subscription ? avatarLookOf(subscription, props.icons) : undefined;
  };
  const domain = () => {
    const subscription = props.subscription;
    return hostLabel(props.item.url ?? subscription?.siteUrl ?? subscription?.url ?? '');
  };
  return (
    <li
      class="news-item"
      ref={(element) => {
        if (!props.item.read) props.onUnreadRow?.(element, props.item.id);
      }}
    >
      <a
        class="news-item__link"
        href={newsItemHash(props.item.id)}
        data-news-item={props.item.id}
        data-read={props.item.read ? 'true' : 'false'}
      >
        <span class="news-item__account">
          <NewsAvatar
            size="xs"
            look={look()}
            glyph={props.subscription?.kind === 'pubmed' ? 'search' : undefined}
          />
          <span class="news-item__source">{props.subscription?.title ?? 'Источник удалён'}</span>
          <Show when={domain() !== ''}>
            <span class="news-item__sep" aria-hidden="true">
              ·
            </span>
            <span class="news-item__domain">{domain()}</span>
          </Show>
          <span class="news-item__sep" aria-hidden="true">
            ·
          </span>
          <time class="news-item__time" dateTime={new Date(props.item.publishedAt).toISOString()}>
            {relativeTimeLabel(props.item.publishedAt, props.now)}
          </time>
          <Show when={!props.item.read}>
            <span class="news-item__dot" role="img" aria-label="не прочитано" />
          </Show>
        </span>
        <span class="news-item__title" classList={{ 'news-item__title--read': props.item.read }}>
          {props.item.title}
        </span>
      </a>
    </li>
  );
}
