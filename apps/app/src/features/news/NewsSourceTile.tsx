import type { JSX } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import type { SuggestedVisual } from '@/features/news/suggested-feeds';

/**
 * The logo-like tile of a source: a coloured monogram declared in `suggested-feeds.json`, or a
 * neutral glyph for sources the user added themselves. Drawn from bundled data only, so showing it
 * never causes a request (ADR-0024).
 */
export function NewsSourceTile(props: {
  readonly visual?: SuggestedVisual | undefined;
  /** Shown on a neutral tile when the source has no `visual`. */
  readonly glyph: AppGlyphName;
  readonly size?: 'regular' | 'small';
}): JSX.Element {
  return (
    <span
      class="news-tile"
      classList={{
        'news-tile--small': props.size === 'small',
        'news-tile--neutral': props.visual === undefined,
      }}
      style={props.visual ? { '--news-tile-hue': String(props.visual.hue) } : undefined}
      aria-hidden="true"
    >
      {props.visual ? (
        <span
          class="news-tile__mark"
          classList={{
            'news-tile__mark--long': (props.visual?.mark.length ?? 0) > 2,
            'news-tile__mark--small': props.size === 'small',
          }}
        >
          {props.visual.mark}
        </span>
      ) : (
        <AppGlyph name={props.glyph} class="news-tile__glyph" />
      )}
    </span>
  );
}
