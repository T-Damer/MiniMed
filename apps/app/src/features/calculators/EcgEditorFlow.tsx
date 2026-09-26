import { createSignal, For, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import type { EcgAutoSummaryStatus } from './ecg-auto-summary';
import { ECG_STEP_GUIDES } from './ecg-editor-guide';
import type { EcgEditorStep } from './ecgEditor';
import type { EcgEditor } from './useEcgEditor';

const STEPS = [1, 2, 3, 4, 5] as const satisfies readonly EcgEditorStep[];

export const ECG_CONFIRM_LABELS: Readonly<Record<Exclude<EcgEditorStep, 5>, string>> = {
  1: 'Фото подходит — далее',
  2: 'Калибровка верна — далее',
  3: 'Отведения верны — далее',
  4: 'Точки верны — к итогу',
};

const STATUS_LABELS: Readonly<Record<EcgAutoSummaryStatus, string>> = {
  found: 'найдено',
  review: 'проверьте',
  missing: 'вручную',
};

export function EcgStepper(props: { readonly editor: EcgEditor }): JSX.Element {
  const e = props.editor;
  const reachable = (step: EcgEditorStep): boolean =>
    step <= e.step() ||
    e
      .completed()
      .slice(0, step - 1)
      .every(Boolean);
  return (
    <ol class="ecg-steps" aria-label="Шаги разметки ЭКГ">
      <For each={STEPS}>
        {(step) => (
          <li class="ecg-steps__item">
            <button
              class="ecg-steps__button"
              classList={{
                'ecg-steps__button--current': e.step() === step,
                'ecg-steps__button--done': step < 5 && e.stepConfirmed(step),
              }}
              type="button"
              aria-current={e.step() === step ? 'step' : undefined}
              disabled={!reachable(step)}
              onClick={() => e.go(step)}
            >
              <span
                class="ecg-steps__marker"
                classList={{ 'ecg-steps__marker--current': e.step() === step }}
                aria-hidden="true"
              >
                <Show when={step < 5 && e.stepConfirmed(step) && e.step() !== step} fallback={step}>
                  <AppGlyph class="ecg-steps__check" name="check" />
                </Show>
              </span>
              <span class="ecg-steps__label">{ECG_STEP_GUIDES[step].label}</span>
            </button>
          </li>
        )}
      </For>
    </ol>
  );
}

export function EcgStepGuide(props: {
  readonly step: EcgEditorStep;
  readonly padded?: boolean;
}): JSX.Element {
  const guide = () => ECG_STEP_GUIDES[props.step];
  return (
    <details class="ecg-guide" classList={{ 'ecg-guide--padded': props.padded ?? false }}>
      <summary class="ecg-guide__summary">
        <AppGlyph class="ecg-guide__icon" name="question" />
        Зачем этот шаг и что проверить
      </summary>
      <div class="ecg-guide__body">
        <p class="ecg-guide__why">{guide().why}</p>
        <h3 class="ecg-guide__heading">Проверьте</h3>
        <ul class="ecg-guide__list">
          <For each={guide().checks}>{(item) => <li class="ecg-guide__item">{item}</li>}</For>
        </ul>
        <h3 class="ecg-guide__heading">Как</h3>
        <p class="ecg-guide__text">{guide().how}</p>
        <h3 class="ecg-guide__heading">Частые ошибки</h3>
        <ul class="ecg-guide__list">
          <For each={guide().mistakes}>
            {(item) => <li class="ecg-guide__item ecg-guide__item--mistake">{item}</li>}
          </For>
        </ul>
      </div>
    </details>
  );
}

export function EcgModelOffer(props: { readonly editor: EcgEditor }): JSX.Element {
  const e = props.editor;
  return (
    <section class="ecg-offer" aria-label="Авторазметка ЭКГ">
      <div class="ecg-offer__copy">
        <strong class="ecg-offer__title">Авторазметка на устройстве</strong>
        <span class="ecg-offer__text">
          Находит сетку, отведения и предлагает точки зубцов. Скачивается один раз и работает без
          интернета. Без неё разметка полностью ручная.
        </span>
      </div>
      <button
        class="ecg-offer__button"
        classList={{ 'ecg-offer__button--busy': e.installing() }}
        type="button"
        onClick={() => void e.install()}
      >
        <AppGlyph class="ecg-offer__icon" name="download" />
        {e.installing()
          ? `Отменить установку · ${Math.round(e.progress() * 100)}%`
          : 'Установить авторазметку · 19 МБ'}
      </button>
      <Show when={e.installing()}>
        <progress class="ecg-offer__progress" max="1" value={e.progress()} />
      </Show>
    </section>
  );
}

export function EcgPerspectivePanel(props: { readonly editor: EcgEditor }): JSX.Element {
  const e = props.editor;
  return (
    <Show when={e.photo()}>
      <section class="ecg-perspective-panel" aria-label="Перспектива снимка">
        <p class="ecg-perspective-panel__text">
          {e.rectified()
            ? 'Снимок выпрямлен по 4 углам листа. Калибровка и разметка идут по выпрямленному снимку; исходное фото сохранено.'
            : e.rectifying()
              ? 'Выпрямляем снимок…'
              : e.detectingCorners()
                ? 'Ищем углы листа…'
                : e.cornerSource() === 'default'
                  ? 'Углы листа не найдены. Если снимок сделан под углом, перетащите четыре угла к углам листа или сетки и выпрямите его.'
                  : 'Углы листа найдены автоматически. Если снимок сделан под углом, проверьте их на фото и выпрямите — клетки сетки станут одинаковыми.'}
        </p>
        <div class="ecg-perspective-panel__actions">
          <Show
            when={e.rectified()}
            fallback={
              <button
                class="ecg-editor__button"
                type="button"
                disabled={!e.corners() || e.rectifying() || e.detectingCorners()}
                onClick={() => void e.rectify()}
              >
                <AppGlyph class="ecg-editor__icon" name="frame-corners" />
                Выпрямить по углам
              </button>
            }
          >
            <button
              class="ecg-editor__button"
              type="button"
              onClick={() => void e.restoreOriginal()}
            >
              <AppGlyph class="ecg-editor__icon" name="arrow-counter-clockwise" />
              Вернуть оригинал
            </button>
          </Show>
        </div>
      </section>
    </Show>
  );
}

export function EcgModelUpdateNotice(props: { readonly editor: EcgEditor }): JSX.Element {
  const e = props.editor;
  const [postponed, setPostponed] = createSignal(false);
  return (
    <Show when={!postponed() && e.modelUpdate()}>
      {(update) => (
        <section class="ecg-update" aria-label="Обновление распознавания ЭКГ">
          <div class="ecg-update__copy">
            <strong class="ecg-update__title">Распознавание ЭКГ устарело — обновить?</strong>
            <span class="ecg-update__text">
              {update().installedVersion === update().catalogVersion
                ? `Доступна исправленная сборка версии ${update().catalogVersion}.`
                : `Установлена версия ${update().installedVersion}, доступна ${update().catalogVersion}.`}{' '}
              Текущая версия работает, пока новая не скачана и не проверена.
            </span>
          </div>
          <div class="ecg-update__actions">
            <button
              class="ecg-offer__button"
              classList={{ 'ecg-offer__button--busy': e.installing() }}
              type="button"
              onClick={() => void e.install()}
            >
              <AppGlyph class="ecg-offer__icon" name="download" />
              {e.installing()
                ? `Отменить · ${Math.round(e.progress() * 100)}%`
                : `Обновить · ${Math.round(update().downloadBytes / 1_000_000)} МБ`}
            </button>
            <Show when={!e.installing()}>
              <button class="ecg-update__later" type="button" onClick={() => setPostponed(true)}>
                Позже
              </button>
            </Show>
          </div>
          <Show when={e.installing()}>
            <progress class="ecg-offer__progress" max="1" value={e.progress()} />
          </Show>
        </section>
      )}
    </Show>
  );
}

export function EcgAutoSummary(props: { readonly editor: EcgEditor }): JSX.Element {
  const e = props.editor;
  return (
    <Show when={e.autoSummary()}>
      {(items) => (
        <section class="ecg-summary" aria-label="Что нашла авторазметка">
          <h3 class="ecg-summary__title">Что нашла авторазметка</h3>
          <ul class="ecg-summary__list">
            <For each={items()}>
              {(item) => (
                <li class="ecg-summary__item">
                  <span
                    class="ecg-summary__status"
                    classList={{
                      'ecg-summary__status--found': item.status === 'found',
                      'ecg-summary__status--review': item.status === 'review',
                      'ecg-summary__status--missing': item.status === 'missing',
                    }}
                  >
                    {STATUS_LABELS[item.status]}
                  </span>
                  <span class="ecg-summary__copy">
                    <strong class="ecg-summary__name">{item.title}.</strong> {item.detail}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </section>
      )}
    </Show>
  );
}
