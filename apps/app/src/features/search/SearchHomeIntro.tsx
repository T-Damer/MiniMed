import type { JSX } from 'solid-js';

import { Carousel, type CarouselSlide } from '@/components/Carousel';
import { featureOfDayIndex } from '@/features/search/feature-of-day';

import './search-home-intro.css';

export type HomeFeature = CarouselSlide;

/** Autoplay step for «Полезные функции»: long enough to read a card's two lines. */
const USEFUL_FEATURES_AUTOPLAY_MS = 7000;

/**
 * Under the empty search field: the tool row, then useful capabilities one card at a time. The
 * carousel opens on today's capability so a returning doctor sees something new each day.
 */
export function SearchHomeIntro(props: {
  readonly quickAccess: JSX.Element;
  readonly features: readonly HomeFeature[];
}): JSX.Element {
  return (
    <div class="search-home-intro">
      <div class="search-home-intro__content">
        {props.quickAccess}
        <Carousel
          class="useful-features"
          label="Полезные функции"
          itemLabel="Функция"
          slides={props.features}
          startIndex={featureOfDayIndex(props.features.length, new Date())}
          autoplayMs={USEFUL_FEATURES_AUTOPLAY_MS}
        />
      </div>
    </div>
  );
}
