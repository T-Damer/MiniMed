import { createSignal, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { DiarySheet } from '@/diary/DiarySheet';
import { InstallGuide } from '@/diary/InstallGuide';
import { InstallGlyph } from '@/diary/install-glyphs';
import { currentInstallAdvice, insideMessenger, requestInstall } from '@/diary/install-state';
import { installWarningTitle, installWarningVisible } from '@/features/diary/diary-install';
import type { DiaryStore } from '@/features/diary/diary-storage';

import '@/diary/install-guide.css';

/**
 * «Добавьте дневник на экран «Домой»» as a warning row. It stays until the diary runs from the
 * icon. A tap shows the browser's own install dialog where there is one; otherwise (or if the
 * patient dismissed it) it opens an animated guide in a bottom sheet. Inside a messenger the same
 * row asks to open the diary in a browser instead.
 */
export function InstallWarning(props: {
  readonly store: DiaryStore;
  /** Entries already made: on iOS the home-screen icon keeps its own storage. */
  readonly entries: number;
}): JSX.Element {
  const [guideOpen, setGuideOpen] = createSignal(false);
  const [asking, setAsking] = createSignal(false);
  const messenger = (): boolean => insideMessenger();

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
        <span class="install-warning__text">{installWarningTitle(messenger())}</span>
        <AppGlyph name="caret-right" class="install-warning__chevron" />
      </button>
      <Show when={guideOpen()}>
        <DiarySheet title={installWarningTitle(messenger())} onClose={() => setGuideOpen(false)}>
          <InstallGuide entries={props.entries} onInstalled={() => setGuideOpen(false)} />
        </DiarySheet>
      </Show>
    </Show>
  );
}
