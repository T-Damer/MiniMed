import { type JSX, Show } from 'solid-js';

import { formatModuleBytes } from '@/features/modules/module-display';

export function BootScreen(props: {
  readonly error: string | undefined;
  readonly bootSlow: boolean;
  readonly coreDownloadRequired?: boolean;
  readonly coreDownloading?: boolean;
  readonly coreProgress?: { readonly loaded: number; readonly total: number } | undefined;
  readonly onDownloadCore?: () => void;
}): JSX.Element {
  const progress = () => props.coreProgress;
  return (
    <section class="boot-screen boot-screen--shell-booting archive-boot">
      <div class="boot-card paper-sheet">
        <Show when={!props.coreDownloadRequired || props.coreDownloading}>
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
                ? 'Открытие базы занимает больше времени, чем обычно. Оставьте окно открытым.'
                : 'Подготавливаем локальный поиск. Интернет для работы не нужен.')}
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
              {progress()
                ? `Скачано ${formatModuleBytes(progress()?.loaded ?? 0)}${(progress()?.total ?? 0) > 0 ? ` из ${formatModuleBytes(progress()?.total ?? 0)}` : ''}. Затем проверим и откроем базу.`
                : 'Соединяемся с сервером…'}
            </p>
            <p class="boot-card__description">
              Держите приложение открытым до завершения установки.
            </p>
          </Show>
        </Show>
        <Show when={props.error || (props.bootSlow && !props.coreDownloadRequired)}>
          <button class="boot-card__action" type="button" onClick={() => window.location.reload()}>
            Повторить
          </button>
        </Show>
      </div>
    </section>
  );
}
