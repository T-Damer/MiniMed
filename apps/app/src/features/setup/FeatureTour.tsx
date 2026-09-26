import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import {
  CanvasDemo,
  DictaphoneDemo,
  PatientDemo,
  SearchDemo,
  ToolsDemo,
  type TourDemoProps,
} from './FeatureTourDemos';

interface TourSlide {
  readonly id: string;
  readonly icon: AppGlyphName;
  readonly title: string;
  readonly text: string;
  readonly badge?: string;
  readonly demo: (props: TourDemoProps) => JSX.Element;
}

const SLIDES: readonly TourSlide[] = [
  {
    id: 'search',
    icon: 'search',
    title: 'Поиск без интернета',
    text: 'Клинические рекомендации, справочники и ваши файлы ищутся прямо на устройстве. Результат открывается на нужном месте источника.',
    demo: SearchDemo,
  },
  {
    id: 'patients',
    icon: 'users',
    title: 'Пациенты и визиты',
    text: 'Карточка, события визитов и показатели на графике. Дневник давления или сахара пациент ведёт у себя в браузере и возвращает QR-кодом.',
    demo: PatientDemo,
  },
  {
    id: 'dictaphone',
    icon: 'microphone',
    title: 'Диктофон приёма',
    text: 'Запись беседы с согласия пациента и расшифровка по говорящим прямо на телефоне. Аудио и текст сохраняются в визит.',
    badge: 'Android',
    demo: DictaphoneDemo,
  },
  {
    id: 'canvas',
    icon: 'edit',
    title: 'Заметки и холст',
    text: 'Пишите от руки или стилусом, связывайте заметки с документами и пациентами.',
    demo: CanvasDemo,
  },
  {
    id: 'tools',
    icon: 'calculator',
    title: 'Шкалы и калькуляторы',
    text: 'Опросники считают баллы, объясняют интерпретацию по источнику шкалы и выводятся на печать.',
    demo: ToolsDemo,
  },
];

const AUTO_ADVANCE_MS = 7_000;
const INTERACTION_PAUSE_MS = 20_000;

export function FeatureTour(): JSX.Element {
  const [active, setActive] = createSignal(0);
  let track: HTMLDivElement | undefined;
  let pausedUntil = 0;
  // A smooth programmatic scroll passes intermediate slides; ignore them until it settles.
  let settling: ReturnType<typeof setTimeout> | undefined;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const endSettling = (): void => {
    clearTimeout(settling);
    settling = undefined;
  };
  const goTo = (index: number): void => {
    if (!track) return;
    const next = (index + SLIDES.length) % SLIDES.length;
    clearTimeout(settling);
    // `scrollend` releases this early; the timeout covers engines without it.
    settling = setTimeout(endSettling, 1_500);
    track.scrollTo({
      left: next * track.clientWidth,
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
    setActive(next);
  };
  const pause = (): void => {
    pausedUntil = Date.now() + INTERACTION_PAUSE_MS;
  };
  const syncFromScroll = (): void => {
    if (!track || track.clientWidth === 0 || settling !== undefined) return;
    const index = Math.round(track.scrollLeft / track.clientWidth);
    if (index !== active() && index >= 0 && index < SLIDES.length) setActive(index);
  };

  onMount(() => {
    if (reducedMotion) return;
    const timer = setInterval(() => {
      if (document.hidden || Date.now() < pausedUntil) return;
      goTo(active() + 1);
    }, AUTO_ADVANCE_MS);
    onCleanup(() => clearInterval(timer));
  });
  onCleanup(() => clearTimeout(settling));

  return (
    <section class="feature-tour" aria-roledescription="карусель" aria-label="Возможности MiniMed">
      <div
        ref={(element) => {
          track = element;
        }}
        class="feature-tour__track"
        onScroll={syncFromScroll}
        on:scrollend={() => {
          endSettling();
          syncFromScroll();
        }}
        onPointerDown={pause}
        onFocusIn={pause}
        onWheel={pause}
      >
        <For each={SLIDES}>
          {(slide, index) => (
            <article
              class="feature-tour__slide"
              classList={{ 'feature-tour__slide--active': index() === active() }}
              aria-roledescription="слайд"
              aria-label={`${index() + 1} из ${SLIDES.length}: ${slide.title}`}
              inert={index() !== active()}
            >
              <div class="feature-tour__stage">
                <Dynamic component={slide.demo} active={index() === active()} />
              </div>
              <div class="feature-tour__copy">
                <h4 class="feature-tour__title">
                  <span class="feature-tour__icon">
                    <AppGlyph name={slide.icon} class="feature-tour__icon-glyph" />
                  </span>
                  {slide.title}
                  <Show when={slide.badge}>
                    {(badge) => <span class="feature-tour__badge">{badge()}</span>}
                  </Show>
                </h4>
                <p class="feature-tour__text">{slide.text}</p>
              </div>
            </article>
          )}
        </For>
      </div>
      <div class="feature-tour__nav">
        <Button
          class="feature-tour__arrow"
          variant="icon"
          aria-label="Предыдущая возможность"
          icon={<AppGlyph name="caret-left" />}
          onClick={() => {
            pause();
            goTo(active() - 1);
          }}
        />
        <div class="feature-tour__dots">
          <For each={SLIDES}>
            {(slide, index) => (
              <button
                class="feature-tour__dot"
                classList={{ 'feature-tour__dot--active': index() === active() }}
                type="button"
                aria-label={slide.title}
                aria-current={index() === active() ? 'true' : undefined}
                onClick={() => {
                  pause();
                  goTo(index());
                }}
              />
            )}
          </For>
        </div>
        <Button
          class="feature-tour__arrow"
          variant="icon"
          aria-label="Следующая возможность"
          icon={<AppGlyph name="caret-right" />}
          onClick={() => {
            pause();
            goTo(active() + 1);
          }}
        />
      </div>
    </section>
  );
}
