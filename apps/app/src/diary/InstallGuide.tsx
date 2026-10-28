import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { InstallScene } from '@/diary/InstallGuideScenes';
import {
  currentInstallAdvice,
  insideMessenger,
  onIpad,
  platform,
  requestInstall,
} from '@/diary/install-state';
import {
  INSTALL_GUIDE_STEPS,
  installGuideKind,
  installGuideNote,
} from '@/features/diary/diary-install';
import { motionMs, motionRate } from '@/state/motion';

import '@/diary/install-guide.css';

const STEP_MS = 1600;
/** The last step (the icon appearing) stays a little longer before the loop restarts. */
const LAST_STEP_MS = 2400;

function animationsAllowed(): boolean {
  if (motionRate() === 0) return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * An animated miniature of the browser screens the patient will see, with the same steps listed
 * under it. The steps loop on their own (tapping one jumps to it); with animations off they stay
 * where the patient left them.
 */
export function InstallGuide(props: {
  /** Entries already made: on iOS the home-screen icon keeps its own storage. */
  readonly entries: number;
  /** A connected diary: its records are with the doctor, so the iPhone note differs. */
  readonly connected?: boolean | undefined;
  /** Called after the browser's own install dialog was accepted. */
  readonly onInstalled?: () => void;
}): JSX.Element {
  const kind = createMemo(() =>
    installGuideKind({ messenger: insideMessenger(), platform: platform(), ipad: onIpad() }),
  );
  const steps = createMemo(() => INSTALL_GUIDE_STEPS[kind()]);
  const note = createMemo(() => installGuideNote(kind(), props.entries, props.connected));
  const [step, setStep] = createSignal(0);
  const [installing, setInstalling] = createSignal(false);
  const animated = animationsAllowed();

  createEffect(() => {
    const current = step();
    const count = steps().length;
    if (!animated || count < 2) return;
    const wait = motionMs(current === count - 1 ? LAST_STEP_MS : STEP_MS);
    const timer = window.setTimeout(() => setStep((current + 1) % count), wait);
    onCleanup(() => window.clearTimeout(timer));
  });

  const install = async (): Promise<void> => {
    setInstalling(true);
    try {
      if (await requestInstall()) props.onInstalled?.();
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div class="install-guide">
      <InstallScene kind={kind()} step={step} />
      <ol class="install-guide__steps">
        <For each={steps()}>
          {(text, index) => (
            <li class="install-guide__item">
              <button
                type="button"
                class="install-guide__step"
                classList={{ 'install-guide__step--current': step() === index() }}
                aria-current={step() === index() ? 'step' : undefined}
                onClick={() => setStep(index())}
              >
                <span
                  class="install-guide__number"
                  classList={{ 'install-guide__number--current': step() === index() }}
                >
                  {index() + 1}
                </span>
                <span class="install-guide__label">{text}</span>
              </button>
            </li>
          )}
        </For>
      </ol>
      <Show when={note()}>{(text) => <p class="install-guide__note">{text()}</p>}</Show>
      <Show when={currentInstallAdvice() === 'prompt'}>
        <Button
          class="diary-button install-guide__install"
          type="button"
          variant="primary"
          disabled={installing()}
          onClick={() => void install()}
        >
          Установить
        </Button>
      </Show>
    </div>
  );
}
