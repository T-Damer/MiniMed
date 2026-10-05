import { For, type JSX, Match, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';

import type { SafeElement, SafeNode } from '@/features/news/feed-content';

export interface NewsRichTextProps {
  readonly nodes: readonly SafeNode[];
  /** Remote images are drawn only when the source has them switched on. */
  readonly images: boolean;
}

function NewsRichElement(props: {
  readonly node: SafeElement;
  readonly images: boolean;
}): JSX.Element {
  return (
    <Switch>
      <Match when={props.node.tag === 'br'}>
        <br />
      </Match>
      <Match when={props.node.tag === 'img'}>
        {props.images && props.node.src ? (
          <img
            class="news-rich__img"
            src={props.node.src}
            alt={props.node.alt ?? ''}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : null}
      </Match>
      <Match when={props.node.tag === 'a'}>
        <a
          class="news-rich__a"
          href={props.node.href}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          <NewsRichText nodes={props.node.children ?? []} images={props.images} />
        </a>
      </Match>
      <Match when={true}>
        <Dynamic component={props.node.tag} class={`news-rich__${props.node.tag}`}>
          <NewsRichText nodes={props.node.children ?? []} images={props.images} />
        </Dynamic>
      </Match>
    </Switch>
  );
}

/**
 * Renders a sanitized feed tree with ordinary element creation. There is no `innerHTML` anywhere
 * on this path: only the allow-listed tags exist, and links are opened in a new context without
 * a referrer.
 */
export function NewsRichText(props: NewsRichTextProps): JSX.Element {
  return (
    <For each={props.nodes}>
      {(node) =>
        typeof node === 'string' ? node : <NewsRichElement node={node} images={props.images} />
      }
    </For>
  );
}
