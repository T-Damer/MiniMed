import { createEffect, createSignal, type JSX, on, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import type { AvatarLook } from '@/features/news/news-avatar';

export type NewsAvatarSize = 'xs' | 'sm' | 'md';

/**
 * The round avatar of a source: its icon, or a monogram coloured by the name when the site has none
 * (or the icon cannot be drawn). A `glyph` draws a neutral tile for sources that are not a site
 * (the PubMed search). Everything shown is bundled or already stored: drawing it sends nothing.
 */
export function NewsAvatar(props: {
  readonly look?: AvatarLook | undefined;
  readonly glyph?: AppGlyphName | undefined;
  readonly size?: NewsAvatarSize;
  /** Shared-element name for a View Transition into the source sheet. */
  readonly transitionName?: string | undefined;
}): JSX.Element {
  const [failed, setFailed] = createSignal(false);
  createEffect(
    on(
      () => props.look?.src,
      () => setFailed(false),
    ),
  );
  const image = () => (failed() ? undefined : props.look?.src);
  return (
    <span
      class={`news-avatar news-avatar--${props.size ?? 'sm'}`}
      classList={{ 'news-avatar--neutral': props.glyph !== undefined }}
      style={{
        '--news-avatar-hue': String(props.look?.hue ?? 0),
        ...(props.transitionName ? { 'view-transition-name': props.transitionName } : {}),
      }}
      aria-hidden="true"
    >
      <Show
        when={props.glyph}
        fallback={
          <Show
            when={image()}
            fallback={<span class="news-avatar__mark">{props.look?.mark ?? '?'}</span>}
          >
            {(src) => (
              <img
                class="news-avatar__image"
                src={src()}
                alt=""
                decoding="async"
                draggable={false}
                onError={() => setFailed(true)}
              />
            )}
          </Show>
        }
      >
        {(glyph) => <AppGlyph name={glyph()} class="news-avatar__glyph" />}
      </Show>
    </span>
  );
}
