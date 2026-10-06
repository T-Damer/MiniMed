import { createSignal, type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import {
  currentInstallAdvice,
  insideMessenger,
  onIpad,
  requestInstall,
} from '@/diary/install-state';
import { installCardDismissed } from '@/features/diary/diary-install';
import type { DiaryStore } from '@/features/diary/diary-storage';

/**
 * A messenger's built-in browser keeps its own storage and cannot add a home-screen icon.
 * Shown whenever the page runs there, until the patient opens the link in a real browser.
 */
export function MessengerWarning(): JSX.Element {
  return (
    <Show when={insideMessenger()}>
      <section class="diary-card diary-card--warning" aria-label="Откройте в браузере">
        <h2 class="diary-card__title">Откройте дневник в браузере</h2>
        <p class="diary-card__text">
          Сейчас дневник открыт внутри другого приложения (например, мессенджера). Записи здесь
          могут пропасть. Нажмите «⋯» или «⋮» и выберите «Открыть в Safari» или «Открыть в
          браузере», затем записывайте в нём.
        </p>
      </section>
    </Show>
  );
}

/**
 * Asks the patient to keep the diary on the phone screen, so it is one tap away and cannot get
 * lost among tabs and bookmarks. Uses the browser's own prompt where there is one; iPhone
 * Safari only has the share sheet, so the steps are written out.
 */
export function InstallCard(props: {
  readonly store: DiaryStore;
  /** Entries already made: on iPhone the home-screen icon starts with an empty diary. */
  readonly entries: number;
}): JSX.Element {
  const [dismissed, setDismissed] = createSignal(
    installCardDismissed(props.store.ui().installDismissedAt, Date.now()),
  );
  const [installing, setInstalling] = createSignal(false);
  const advice = () => currentInstallAdvice();

  const dismiss = (): void => {
    props.store.setUi({ installDismissedAt: new Date().toISOString() });
    setDismissed(true);
  };

  const install = async (): Promise<void> => {
    setInstalling(true);
    try {
      await requestInstall();
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Show
      when={!insideMessenger() && !dismissed() && advice() !== 'installed' && advice() !== 'none'}
    >
      <section class="diary-card" aria-label="Добавить дневник на экран телефона">
        <h2 class="diary-card__title">Добавьте дневник на экран телефона</h2>
        <p class="diary-card__text">
          Так он откроется одним касанием и не потеряется среди закладок. Записи останутся на этом
          телефоне.
        </p>
        <Show when={advice() === 'prompt'}>
          <div class="diary-card__actions">
            <Button
              class="diary-button"
              type="button"
              variant="primary"
              disabled={installing()}
              onClick={() => void install()}
            >
              Добавить на экран
            </Button>
            <Button class="diary-button" type="button" onClick={dismiss}>
              Не сейчас
            </Button>
          </div>
        </Show>
        <Show when={advice() === 'ios'}>
          <ol class="diary-card__steps">
            <li class="diary-card__step">
              <Show
                when={onIpad()}
                fallback={
                  <>
                    Нажмите «⋯» внизу экрана Safari и выберите «Поделиться» (в прежних версиях —
                    квадрат со стрелкой внизу экрана).
                  </>
                }
              >
                Нажмите «Поделиться» — квадрат со стрелкой в верхней панели Safari.
              </Show>
            </li>
            <li class="diary-card__step">Выберите «На экран «Домой»».</li>
            <li class="diary-card__step">Нажмите «Добавить».</li>
          </ol>
          <Show
            when={props.entries > 0}
            fallback={<p class="diary-card__text">Лучше сделать это сейчас, до первой записи.</p>}
          >
            <p class="diary-card__text">
              Значок на экране «Домой» на {onIpad() ? 'iPad' : 'iPhone'} открывает отдельный пустой
              дневник. Чтобы перенести записи, нажмите «Передать врачу» → «Сохранить файл», а в
              дневнике с экрана «Домой» выберите «Восстановить записи».
            </p>
          </Show>
          <div class="diary-card__actions">
            <Button class="diary-button" type="button" onClick={dismiss}>
              Понятно, не сейчас
            </Button>
          </div>
        </Show>
        <Show when={advice() === 'manual'}>
          <p class="diary-card__text">
            Откройте меню браузера («⋮») и выберите «Добавить на главный экран» или «Установить
            приложение».
          </p>
          <div class="diary-card__actions">
            <Button class="diary-button" type="button" onClick={dismiss}>
              Понятно, не сейчас
            </Button>
          </div>
        </Show>
      </section>
    </Show>
  );
}
