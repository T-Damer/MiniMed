import { createEffect, createSignal, type JSX, on, onCleanup, Show } from 'solid-js';

import { BrandMark } from '@/components/BrandMark';
import { Button } from '@/components/Button';
import { OnboardingArrow } from './OnboardingArrow';
import type { IntroPhase } from './onboarding-controller';
import type { Point } from './onboarding-geometry';

/** Where the arrow of the intro starts and ends, in viewport pixels. */
function introArrow(
  text: HTMLElement,
  viewport: { width: number; height: number },
): {
  readonly from: Point;
  readonly to: Point;
} {
  const box = text.getBoundingClientRect();
  return {
    from: { x: box.left + box.width * 0.72, y: box.bottom + 16 },
    // The progress label sits in the bottom right corner, right above its thin line.
    to: { x: viewport.width - 64, y: viewport.height - 24 },
  };
}

/**
 * Step 1: the full-screen intro over the blurred app. Three scenes crossfade — the greeting, the
 * welcome, and the core download (with an arrow to the progress line along the bottom edge).
 */
export function OnboardingIntro(props: {
  readonly phase: IntroPhase;
  readonly coreReady: boolean;
  readonly coreDeferred: boolean;
  readonly coreError: string | undefined;
  readonly onNext: (button: HTMLElement) => void;
  readonly onSkip: () => void;
  readonly onDownloadCore: () => void;
}): JSX.Element {
  const [arrow, setArrow] = createSignal<{ readonly from: Point; readonly to: Point }>();
  let coreText: HTMLElement | undefined;

  const coreVisible = () => props.phase === 'core' || props.phase === 'ready';
  const arrowWanted = () => coreVisible() && !props.coreReady;

  const placeArrow = (): void => {
    if (!coreText || !arrowWanted()) {
      setArrow(undefined);
      return;
    }
    setArrow(introArrow(coreText, { width: window.innerWidth, height: window.innerHeight }));
  };
  createEffect(
    on([arrowWanted, () => props.phase, () => props.coreDeferred, () => props.coreError], () => {
      // After layout: the scene's text has its final box one frame after it is shown.
      const frame = requestAnimationFrame(() => requestAnimationFrame(placeArrow));
      onCleanup(() => cancelAnimationFrame(frame));
    }),
  );
  window.addEventListener('resize', placeArrow, { passive: true });
  onCleanup(() => window.removeEventListener('resize', placeArrow));

  const coreHeadline = (): string => {
    if (props.coreReady) return 'Ядро знаний уже на месте';
    if (props.coreError)
      return 'Ядро скачать не получилось — проверь интернет и нажми «Повторить» внизу';
    if (props.coreDeferred) {
      return 'Ядро знаний занимает около 490 МБ, а ты в мобильной сети — скачай сейчас или позже по Wi‑Fi';
    }
    return 'Сейчас нам надо скачать ядро знаний — прогресс загрузки ты увидишь внизу';
  };
  const nextHint = (): string =>
    props.coreReady
      ? 'Нажми «Далее» — покажу, что умеет приложение'
      : 'Нажми «Далее», чтобы продолжить изучать приложение, пока идёт загрузка';

  return (
    <div
      class="onboarding-intro"
      role="dialog"
      aria-modal="true"
      aria-label="Добро пожаловать в MiniMed"
      tabindex="-1"
    >
      <div class="onboarding-intro__stage" aria-live="polite">
        <section
          class="onboarding-intro__scene onboarding-intro__scene--hello"
          classList={{ 'onboarding-intro__scene--shown': props.phase === 'hello' }}
          aria-hidden={props.phase === 'hello' ? undefined : 'true'}
        >
          <p class="onboarding-intro__hello">Привет</p>
        </section>

        <section
          class="onboarding-intro__scene onboarding-intro__scene--welcome"
          classList={{ 'onboarding-intro__scene--shown': props.phase === 'welcome' }}
          aria-hidden={props.phase === 'welcome' ? undefined : 'true'}
        >
          <BrandMark class="onboarding-intro__mark" title="MiniMed" />
          <h1 class="onboarding-intro__title">Добро пожаловать в MiniMed</h1>
          <p class="onboarding-intro__subtitle">Твой персональный помощник по медицине</p>
        </section>

        <section
          class="onboarding-intro__scene onboarding-intro__scene--core"
          classList={{ 'onboarding-intro__scene--shown': coreVisible() }}
          aria-hidden={coreVisible() ? undefined : 'true'}
        >
          <div
            class="onboarding-intro__core"
            ref={(element) => {
              coreText = element;
            }}
          >
            <p class="onboarding-intro__lead">{coreHeadline()}</p>
            <Show when={props.coreDeferred && !props.coreReady}>
              <Button
                class="onboarding-intro__download"
                variant="secondary"
                onClick={props.onDownloadCore}
              >
                Скачать · ~490 МБ
              </Button>
            </Show>
            <p
              class="onboarding-intro__hint"
              classList={{ 'onboarding-intro__hint--shown': props.phase === 'ready' }}
              aria-hidden={props.phase === 'ready' ? undefined : 'true'}
            >
              {nextHint()}
            </p>
          </div>
        </section>
      </div>

      <Show when={arrow()}>
        {(points) => (
          <OnboardingArrow from={points().from} to={points().to} seed={11} delayMs={350} />
        )}
      </Show>

      <div class="onboarding-intro__footer">
        <Button
          class="onboarding-intro__next"
          classList={{
            'onboarding-intro__next--shown': props.phase === 'ready',
            'onboarding-intro__next--ready': props.coreReady,
          }}
          variant="primary"
          tabindex={props.phase === 'ready' ? undefined : -1}
          aria-hidden={props.phase === 'ready' ? undefined : 'true'}
          onClick={(event) => props.onNext(event.currentTarget)}
        >
          Далее
        </Button>
        <Button
          class="onboarding-intro__skip"
          classList={{
            'onboarding-intro__skip--shown': props.phase !== 'wait' && props.phase !== 'hello',
          }}
          variant="quiet"
          tabindex={props.phase === 'wait' || props.phase === 'hello' ? -1 : undefined}
          onClick={props.onSkip}
        >
          Пропустить обучение
        </Button>
      </div>
    </div>
  );
}
