import { createSignal, type JSX, Show } from 'solid-js';
import { CalmError } from '@/components/CalmError';
import { CORE_DOWNLOAD_SIZE_LABEL } from '@/composition/core-download';

import { formatModuleBytes } from '@/features/modules/module-display';
import { requestTakeover } from '@/state/tab-takeover';

export function BootScreen(props: {
  readonly error: string | undefined;
  readonly bootSlow: boolean;
  /** Another tab owns the local database; this one opens it once that tab closes. */
  readonly waitingForOtherTab?: boolean;
  /** Overrides what «Использовать здесь» does (the standby page reloads into the owner tab). */
  readonly onUseHere?: () => void;
  readonly coreDownloadRequired?: boolean;
  readonly coreDownloading?: boolean;
  /** The download was asked for while offline: it starts by itself when the network returns. */
  readonly coreWaitingForNetwork?: boolean;
  readonly coreProgress?:
    | {
        readonly loaded: number;
        readonly total: number;
        readonly phase?: 'downloading' | 'verifying' | 'installing';
      }
    | undefined;
  readonly onDownloadCore?: () => void;
}): JSX.Element {
  const progress = () => props.coreProgress;
  const [takingOver, setTakingOver] = createSignal(false);
  const bootCard = (): JSX.Element => (
    <section
      class="boot-screen boot-screen--shell-booting archive-boot"
      classList={{ 'boot-screen--core-setup': props.coreDownloadRequired }}
    >
      <div class="boot-card paper-sheet">
        <Show when={!props.coreDownloadRequired || props.coreDownloading}>
          <span class="boot-spinner" />
        </Show>
        <p class="archive-kicker">Локальная медицинская база</p>
        <h1 class="boot-card__title">
          {props.waitingForOtherTab
            ? 'MiniMed открыт в другой вкладке'
            : props.coreDownloadRequired
              ? props.coreDownloading
                ? 'Скачиваем основную базу MiniMed'
                : 'Скачайте основную базу MiniMed'
              : 'Подготавливаем поиск…'}
        </h1>
        <p class="boot-card__description">
          {props.waitingForOtherTab
            ? 'Локальную базу одновременно может открыть только одна вкладка. Закройте другую вкладку или окно MiniMed — или перенесите работу сюда.'
            : props.coreDownloadRequired
              ? props.coreDownloading
                ? `Основная база нужна для поиска, загрузка около ${CORE_DOWNLOAD_SIZE_LABEL}. После загрузки поиск работает без интернета. Свои файлы и настройки доступны уже сейчас.`
                : `Основная база — около ${CORE_DOWNLOAD_SIZE_LABEL}: скачайте сейчас или позже по Wi‑Fi. Свои файлы и настройки доступны и без неё.`
              : props.bootSlow
                ? 'Подготовка базы продолжается. Свои файлы и настройки доступны через нижнее меню.'
                : 'Поиск откроется, когда основная база будет готова. Пока можно пользоваться своими файлами и настройками.'}
        </p>
        <Show when={props.coreDownloadRequired}>
          <Show
            when={props.coreDownloading}
            fallback={
              <button class="boot-card__action" type="button" onClick={props.onDownloadCore}>
                Скачать основную базу · ~{CORE_DOWNLOAD_SIZE_LABEL}
              </button>
            }
          >
            <p class="boot-card__progress" role="status" aria-live="polite">
              {props.coreWaitingForNetwork
                ? 'Нет сети. Загрузка начнётся сама, когда появится соединение.'
                : progress()?.phase === 'verifying'
                  ? 'Проверяем контрольную сумму основной базы…'
                  : progress()?.phase === 'installing'
                    ? 'Устанавливаем проверенную основную базу…'
                    : progress()
                      ? `Скачано ${formatModuleBytes(progress()?.loaded ?? 0)}${(progress()?.total ?? 0) > 0 ? ` из ${formatModuleBytes(progress()?.total ?? 0)}` : ''}. Затем проверим и откроем базу.`
                      : 'Начинаем загрузку…'}
            </p>
            <p class="boot-card__description">
              Скачивание продолжается в фоне. Вернитесь в приложение, чтобы завершить проверку и
              открытие базы.
            </p>
          </Show>
        </Show>
        <Show when={props.waitingForOtherTab}>
          <button
            class="boot-card__action"
            type="button"
            disabled={takingOver()}
            onClick={() => {
              setTakingOver(true);
              if (props.onUseHere) props.onUseHere();
              else requestTakeover();
            }}
          >
            {takingOver() ? 'Переключаем…' : 'Использовать здесь'}
          </button>
        </Show>
      </div>
    </section>
  );

  return (
    <Show when={props.error} fallback={bootCard()}>
      {(error) => {
        // The cause is for the console; the screen says only what happens next.
        console.error('База не открылась.', error());
        return (
          <CalmError
            title="База не открылась"
            detail="Попробуйте открыть ещё раз."
            onAction={() => window.location.reload()}
          />
        );
      }}
    </Show>
  );
}
