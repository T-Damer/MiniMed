import { createSignal, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { DiarySheet } from '@/diary/DiarySheet';
import { InstallGuide } from '@/diary/InstallGuide';
import { InstallGlyph } from '@/diary/install-glyphs';
import { currentInstallAdvice, insideMessenger, requestInstall } from '@/diary/install-state';
import {
  installCardDismissed,
  installWarningTitle,
  installWarningVisible,
} from '@/features/diary/diary-install';
import type { DiaryStore } from '@/features/diary/diary-storage';

import '@/diary/install-guide.css';

/**
 * «Добавьте дневник на экран «Домой»» as a warning row. It stays until the diary runs from the
 * icon. A tap shows the browser's own install dialog where there is one; otherwise (or if the
 * patient dismissed it) it opens an animated guide in a bottom sheet. Inside a messenger the same
 * row asks to open the diary in a browser instead.
 */
export function InstallWarning(props: {
  readonly store?: DiaryStore;
  /** Entries already made: on iOS the home-screen icon keeps its own storage. */
  readonly entries: number;
  /** A connected diary (the iPhone note tells to ask the doctor for a new code). */
  readonly connected?: boolean | undefined;
  /** The row's words outside a messenger (the doctor's diaries app has its own). */
  readonly title?: string;
}): JSX.Element {
  const [guideOpen, setGuideOpen] = createSignal(false);
  const [asking, setAsking] = createSignal(false);
  const messenger = (): boolean => insideMessenger();
  const title = (): string =>
    messenger() || !props.title ? installWarningTitle(messenger()) : props.title;

  const open = async (): Promise<void> => {
    if (currentInstallAdvice() === 'prompt' && !messenger()) {
      setAsking(true);
      try {
        if (await requestInstall()) return;
      } finally {
        setAsking(false);
      }
    }
    setGuideOpen(true);
  };

  return (
    <Show when={installWarningVisible({ messenger: messenger(), advice: currentInstallAdvice() })}>
      <button
        type="button"
        class="install-warning"
        classList={{ 'install-warning--busy': asking() }}
        aria-haspopup="dialog"
        onClick={() => void open()}
      >
        <InstallGlyph name="warning" class="install-warning__icon" />
        <span class="install-warning__text">{title()}</span>
        <AppGlyph name="caret-right" class="install-warning__chevron" />
      </button>
      <Show when={guideOpen()}>
        <DiarySheet title={title()} onClose={() => setGuideOpen(false)}>
          <InstallGuide
            entries={props.entries}
            connected={props.connected}
            onInstalled={() => setGuideOpen(false)}
          />
        </DiarySheet>
      </Show>
    </Show>
  );
}

const CARD_DISMISSED_KEY = 'minimed.diaries.install-card-dismissed-at';

function readDismissed(): string | undefined {
  try {
    return localStorage.getItem(CARD_DISMISSED_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The doctor's «install the app» invitation (owner 2026-11-04): not a warning, a card with the
 * app's icon, what it gives, «Установить» and «Не сейчас» (back in a week). «Установить» opens the
 * browser's own dialog where there is one, else the same guide as the patient's row.
 */
export function InstallCard(props: {
  readonly title: string;
  readonly text: string;
  readonly icon: string;
}): JSX.Element {
  const [guideOpen, setGuideOpen] = createSignal(false);
  const [asking, setAsking] = createSignal(false);
  const [dismissed, setDismissed] = createSignal(installCardDismissed(readDismissed(), Date.now()));
  const install = async (): Promise<void> => {
    if (currentInstallAdvice() === 'prompt') {
      setAsking(true);
      try {
        if (await requestInstall()) return;
      } finally {
        setAsking(false);
      }
    }
    setGuideOpen(true);
  };
  const later = (): void => {
    try {
      localStorage.setItem(CARD_DISMISSED_KEY, new Date().toISOString());
    } catch {
      // Storage refused: the card goes away for this visit only.
    }
    setDismissed(true);
  };
  return (
    <Show
      when={
        !dismissed() &&
        !insideMessenger() &&
        installWarningVisible({ messenger: false, advice: currentInstallAdvice() })
      }
    >
      <section class="install-card" aria-label={props.title}>
        <img class="install-card__icon" src={props.icon} alt="" width="48" height="48" />
        <div class="install-card__text">
          <p class="install-card__title">{props.title}</p>
          <p class="install-card__lead">{props.text}</p>
        </div>
        <div class="install-card__actions">
          <Button variant="primary" disabled={asking()} onClick={() => void install()}>
            Установить
          </Button>
          <Button variant="quiet" onClick={later}>
            Не сейчас
          </Button>
        </div>
      </section>
      <Show when={guideOpen()}>
        <DiarySheet title={props.title} onClose={() => setGuideOpen(false)}>
          <InstallGuide entries={0} connected onInstalled={() => setGuideOpen(false)} />
        </DiarySheet>
      </Show>
    </Show>
  );
}
