import { type JSX, Show } from 'solid-js';

export function BootScreen(props: {
  readonly error: string | undefined;
  readonly bootSlow: boolean;
}): JSX.Element {
  return (
    <section class="boot-screen boot-screen--shell-booting archive-boot">
      <div class="boot-card paper-sheet">
        <span class="boot-spinner" />
        <p class="archive-kicker">Локальная медицинская база</p>
        <h1>{props.error ? 'База не открылась' : 'Открываем документы…'}</h1>
        <p>
          {props.error ??
            (props.bootSlow
              ? 'Загрузка базы занимает необычно много времени. Оставьте окно открытым, мы продолжаем загрузку в фоне.'
              : 'Подготавливаем локальный поиск. Интернет для работы не нужен.')}
        </p>
        <Show when={props.error || props.bootSlow}>
          <button type="button" onClick={() => window.location.reload()}>
            Повторить загрузку
          </button>
        </Show>
      </div>
    </section>
  );
}
