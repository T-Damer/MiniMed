import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { HorizontalScroller } from '@/components/HorizontalScroller';
import { OverlayDialog } from '@/components/OverlayDialog';
import type { AssessmentImage } from '@/features/assessments/assessment-types';

export function AssessmentImageCarousel(props: {
  readonly images: readonly AssessmentImage[];
  readonly label?: string;
  readonly class?: string;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal<AssessmentImage>();
  const label = () => props.label ?? 'Изображения';

  return (
    <Show when={props.images.length > 0}>
      <section class={`assessment-image-carousel ${props.class ?? ''}`.trim()} aria-label={label()}>
        <HorizontalScroller
          class="assessment-image-carousel__scroller"
          viewportClass="assessment-image-carousel__viewport"
          controls
          hideScrollbar
          controlLabel={label()}
        >
          <div class="assessment-image-carousel__grid">
            <For each={props.images}>
              {(image) => (
                <button
                  type="button"
                  class="assessment-image-carousel__item"
                  aria-label={`Увеличить: ${image.alt}`}
                  onClick={() => setExpanded(image)}
                >
                  <img
                    class="assessment-image-carousel__image"
                    src={image.dataUrl}
                    alt={image.alt}
                    loading="lazy"
                  />
                  <span class="assessment-image-carousel__expand" aria-hidden="true">
                    <AppGlyph name="arrows-out" class="assessment-image-carousel__expand-icon" />
                  </span>
                </button>
              )}
            </For>
          </div>
        </HorizontalScroller>
      </section>
      <OverlayDialog
        open={Boolean(expanded())}
        title={expanded()?.alt ?? 'Изображение'}
        class="assessment-image-carousel__lightbox"
        bodyClass="assessment-image-carousel__lightbox-body"
        onClose={() => setExpanded(undefined)}
      >
        <Show when={expanded()}>
          {(image) => (
            <img
              class="assessment-image-carousel__lightbox-image"
              src={image().dataUrl}
              alt={image().alt}
            />
          )}
        </Show>
      </OverlayDialog>
    </Show>
  );
}
