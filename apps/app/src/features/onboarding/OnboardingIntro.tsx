import { createEffect, createSignal, type JSX, on, onCleanup, Show } from 'solid-js';
import { Button } from '@/components/Button';
import { CORE_DOWNLOAD_SIZE_LABEL } from '@/composition/core-download';
import { OnboardingArrow } from './OnboardingArrow';
import { OnboardingDocuments } from './OnboardingDocuments';
import type { IntroPhase } from './onboarding-controller';
import type { Point } from './onboarding-geometry';

/** Clear space between the arrow's tip and the progress label it points at. */
const LABEL_GAP = 10;

/**
 * Where the arrow of the intro starts and ends, in viewport pixels. It ends just above the
 * progress label along the bottom edge, measured from the label itself so the arrow follows it
 * whatever its text, width or the device's bottom inset.
 */
function introArrow(
  text: HTMLElement,
  viewport: { width: number; height: number },
): {
  readonly from: Point;
  readonly to: Point;
} {
  const box = text.getBoundingClientRect();
  const label = document
    .querySelector<HTMLElement>('.core-progress-line__caption')
    ?.getBoundingClientRect();
  // Point at the right end of the label: the footer's buttons sit in the middle, and the arrow
  // must come down beside them, never across.
  const to = label
    ? { x: label.right - Math.min(36, label.width / 2), y: label.top - LABEL_GAP }
    : { x: viewport.width - 48, y: viewport.height - 48 };
  return { from: { x: Math.min(box.right - 8, to.x - 6), y: box.bottom + 16 }, to };
}

/**
 * Step 1: the full-screen intro over the blurred app. Three scenes crossfade, each moving on only
 * when the user presses «Далее» — the greeting over the app icon, a few words about the app, and
 * the core download (the icon opens up and its documents float; an arrow points to the progress
 * line along the bottom edge).
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

  const coreVisible = () => props.phase === 'core';
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
  // The label grows and shrinks with its text («37 % · 4,2 МБ/с»): keep the arrow on it.
  const labelWatcher = new ResizeObserver(() => placeArrow());
  createEffect(() => {
    if (!arrow()) return;
    const label = document.querySelector('.core-progress-line__caption');
    if (!label) return;
    labelWatcher.observe(label);
    onCleanup(() => labelWatcher.unobserve(label));
  });
  onCleanup(() => labelWatcher.disconnect());

  const coreHeadline = (): string => {
    if (props.coreReady) return 'Ядро знаний уже на месте';
    if (props.coreError)
      return 'Ядро скачать не получилось — проверь интернет и нажми «Повторить» внизу';
    if (props.coreDeferred) {
      return `Загрузка ядра знаний — около ${CORE_DOWNLOAD_SIZE_LABEL}, а ты в мобильной сети: скачай сейчас или позже по Wi‑Fi`;
    }
    return 'Сейчас нам надо скачать ядро знаний — прогресс загрузки ты увидишь внизу';
  };
  const nextHint = (): string =>
    props.coreReady
      ? 'Нажми «Далее» — покажу, что умеет приложение'
      : 'Нажми «Далее», чтобы продолжить изучать приложение, пока идёт загрузка';
  const footerShown = () => props.phase !== 'wait';

  return (
    <div
      class="onboarding-intro"
      role="dialog"
      aria-modal="true"
      aria-label="Добро пожаловать в MiniMed"
      tabindex="-1"
    >
      <div class="onboarding-intro__stage">
        <div class="onboarding-intro__logo">
          <OnboardingDocuments out={coreVisible()} />
          {/* The anchor of the intro from the first moment: the splash icon flies onto it. */}
          <img
            class="onboarding-intro__mark"
            classList={{ 'onboarding-intro__mark--away': coreVisible() }}
            src={`${import.meta.env.BASE_URL}boot-icon.png`}
            alt=""
            width="104"
            height="104"
            decoding="async"
          />
        </div>
        <div class="onboarding-intro__scenes" aria-live="polite">
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
            <h1 class="onboarding-intro__title">Добро пожаловать в MiniMed</h1>
            <p class="onboarding-intro__subtitle">Твой персональный помощник по медицине</p>
            <p class="onboarding-intro__about">
              Поиск по справочникам и рекомендациям, опросники, калькуляторы и личные файлы — всё
              хранится и работает на твоём устройстве, без интернета.
            </p>
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
                  Скачать · ~{CORE_DOWNLOAD_SIZE_LABEL}
                </Button>
              </Show>
              <p class="onboarding-intro__hint">{nextHint()}</p>
            </div>
          </section>
        </div>
      </div>

      <Show when={arrow()}>
        {(points) => (
          <OnboardingArrow
            from={points().from}
            to={points().to}
            seed={11}
            width={window.innerWidth}
            height={window.innerHeight}
            delayMs={350}
          />
        )}
      </Show>

      <div class="onboarding-intro__footer">
        <Button
          class="onboarding-intro__next"
          classList={{
            'onboarding-intro__next--shown': footerShown(),
            'onboarding-intro__next--ready': props.coreReady && coreVisible(),
          }}
          variant="primary"
          tabindex={footerShown() ? undefined : -1}
          aria-hidden={footerShown() ? undefined : 'true'}
          onClick={(event) => props.onNext(event.currentTarget)}
        >
          Далее
        </Button>
        <Button
          class="onboarding-intro__skip"
          classList={{ 'onboarding-intro__skip--shown': footerShown() }}
          variant="quiet"
          tabindex={footerShown() ? undefined : -1}
          onClick={props.onSkip}
        >
          Пропустить обучение
        </Button>
      </div>
    </div>
  );
}
