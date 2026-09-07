import { type JSX, Show } from 'solid-js';

import { formatModuleBytes } from '@/features/modules/module-display';

export function BootScreen(props: {
  readonly error: string | undefined;
  readonly bootSlow: boolean;
  readonly coreDownloadRequired?: boolean;
  readonly coreDownloading?: boolean;
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
  return (
    <section
      class="boot-screen boot-screen--shell-booting archive-boot"
      classList={{ 'boot-screen--core-setup': props.coreDownloadRequired }}
    >
      <div class="boot-card paper-sheet">
        <Show when={!props.error && (!props.coreDownloadRequired || props.coreDownloading)}>
          <span class="boot-spinner" />
        </Show>
        <p class="archive-kicker">Локальная медицинская база</p>
        <h1 class="boot-card__title">
          {props.error
            ? 'База не открылась'
            : props.coreDownloadRequired
              ? 'Скачайте ядро MiniMed'
              : 'Открываем документы…'}
        </h1>
        <p class="boot-card__description">
          {props.error ??
            (props.coreDownloadRequired
              ? 'Приложение установлено. Для первого запуска скачайте базу — около 490 МБ. После установки поиск и скачанные документы работают без интернета. Иллюстрации и дополнительные наборы доступны в настройках.'
              : props.bootSlow
                ? 'Подготовка базы продолжается. Калькуляторы и шкалы уже доступны через нижнее меню.'
                : 'Подготавливаем локальный поиск. Калькуляторы и шкалы уже доступны через нижнее меню.')}
        </p>
        <Show when={props.coreDownloadRequired && !props.error}>
          <Show
            when={props.coreDownloading}
            fallback={
              <button class="boot-card__action" type="button" onClick={props.onDownloadCore}>
                Скачать ядро · ~490 МБ
              </button>
            }
          >
            <p class="boot-card__progress" role="status" aria-live="polite">
              {progress()?.phase === 'verifying'
                ? 'Проверяем контрольную сумму ядра…'
                : progress()?.phase === 'installing'
                  ? 'Устанавливаем проверенное ядро…'
                  : progress()
                    ? `Скачано ${formatModuleBytes(progress()?.loaded ?? 0)}${(progress()?.total ?? 0) > 0 ? ` из ${formatModuleBytes(progress()?.total ?? 0)}` : ''}. Затем проверим и откроем базу.`
                    : 'Соединяемся с сервером…'}
            </p>
            <p class="boot-card__description">
              Скачивание продолжается в фоне. Вернитесь в приложение, чтобы завершить проверку и
              открытие базы.
            </p>
          </Show>
        </Show>
        <Show when={props.error}>
          <button class="boot-card__action" type="button" onClick={() => window.location.reload()}>
            Повторить
          </button>
        </Show>
      </div>
    </section>
  );
}
