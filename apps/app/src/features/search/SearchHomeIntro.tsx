import { type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { Carousel, type CarouselSlide } from '@/components/Carousel';
import { onboardingOnScreen } from '@/features/onboarding/onboarding-state';
import { featureOfDayIndex } from '@/features/search/feature-of-day';

import './search-home-intro.css';

export type HomeFeature = CarouselSlide;

/** Autoplay step for «Полезные функции»: long enough to read a card's two lines. */
const USEFUL_FEATURES_AUTOPLAY_MS = 7000;

/**
 * Under the empty search field: the tool row, then useful capabilities one card at a time. The
 * carousel opens on today's capability so a returning doctor sees something new each day. It
 * holds still while the onboarding is open, so a capability the tour points at stays in view.
 */
export function SearchHomeIntro(props: {
  readonly quickAccess: JSX.Element;
  readonly features: readonly HomeFeature[];
  /** The user closed «Полезные функции»; the tool row stays. */
  readonly featuresHidden: boolean;
  readonly onHideFeatures: () => void;
}): JSX.Element {
  return (
    <div class="search-home-intro">
      <div class="search-home-intro__content">
        {props.quickAccess}
        <Show when={!props.featuresHidden}>
          <Carousel
            class="useful-features"
            label="Полезные функции"
            itemLabel="Функция"
            slides={props.features}
            startIndex={featureOfDayIndex(props.features.length, new Date())}
            autoplayMs={USEFUL_FEATURES_AUTOPLAY_MS}
            autoplayPaused={onboardingOnScreen}
            controlsEnd={
              <Button
                variant="quiet"
                class="useful-features__hide"
                aria-label="Скрыть полезные функции"
                onClick={props.onHideFeatures}
              >
                Скрыть
              </Button>
            }
          />
        </Show>
      </div>
    </div>
  );
}
