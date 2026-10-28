import { createUniqueId, type JSX, onCleanup, onMount, Show, Suspense } from 'solid-js';
import { Portal } from 'solid-js/web';

import { AppGlyph } from '@/components/AppGlyph';
import { SkeletonLines } from '@/components/SkeletonLines';

const SHEET_KEY = 'diarySheet';

/**
 * A sheet that rises from the bottom of the diary page. It is a step in the browser history, so
 * the phone's Back button closes it instead of leaving the page; Escape and the backdrop close it
 * too. `onClose` runs once, after the history step is gone.
 */
export function DiarySheet(props: {
  readonly title: string;
  readonly subtitle?: string | undefined;
  /** Tall content (a questionnaire) takes the whole height. */
  readonly tall?: boolean;
  readonly footer?: JSX.Element;
  readonly children: JSX.Element;
  readonly onClose: () => void;
}): JSX.Element {
  const id = createUniqueId();
  let title: HTMLHeadingElement | undefined;
  let closed = false;

  const finish = (): void => {
    if (closed) return;
    closed = true;
    props.onClose();
  };
  /** Closes through the history so Back and the close button leave the same state. */
  const close = (): void => {
    const state = window.history.state as Record<string, unknown> | null;
    if (state?.[SHEET_KEY] === id) window.history.back();
    else finish();
  };

  onMount(() => {
    const state = (window.history.state as Record<string, unknown> | null) ?? {};
    window.history.pushState({ ...state, [SHEET_KEY]: id }, '', window.location.href);
    const onPop = (): void => {
      const current = window.history.state as Record<string, unknown> | null;
      if (current?.[SHEET_KEY] !== id) finish();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    title?.focus({ preventScroll: true });
    document.documentElement.classList.add('diary-sheet-open');
    onCleanup(() => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('diary-sheet-open');
      // Unmounted by the page (a save) while its history step is still on top: drop the step.
      const current = window.history.state as Record<string, unknown> | null;
      if (!closed && current?.[SHEET_KEY] === id) {
        closed = true;
        window.history.back();
      }
    });
  });

  return (
    <Portal>
      <div class="diary-sheet">
        <button
          type="button"
          class="diary-sheet__backdrop"
          aria-label="Закрыть"
          tabindex="-1"
          onClick={close}
        />
        <section
          class="diary-sheet__panel"
          classList={{ 'diary-sheet__panel--tall': props.tall ?? false }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-title`}
        >
          <header class="diary-sheet__header">
            <div class="diary-sheet__heading">
              <h2 class="diary-sheet__title" id={`${id}-title`} tabindex="-1" ref={title}>
                {props.title}
              </h2>
              <Show when={props.subtitle}>
                <p class="diary-sheet__subtitle">{props.subtitle}</p>
              </Show>
            </div>
            <button type="button" class="diary-sheet__close" aria-label="Закрыть" onClick={close}>
              <AppGlyph name="close" class="diary-sheet__close-icon" />
            </button>
          </header>
          <div class="diary-sheet__body">
            <Suspense fallback={<SkeletonLines label="Загружаем" lines={3} />}>
              {props.children}
            </Suspense>
          </div>
          <Show when={props.footer}>
            <footer class="diary-sheet__footer">{props.footer}</footer>
          </Show>
        </section>
      </div>
    </Portal>
  );
}

/** Text area that grows with what is typed (no inner scrollbar on a phone). */
export function GrowingText(props: {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly autofocus?: boolean;
  readonly onInput: (value: string) => void;
}): JSX.Element {
  let area: HTMLTextAreaElement | undefined;
  const fit = (): void => {
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
  };
  onMount(() => {
    fit();
    if (props.autofocus) area?.focus();
  });
  return (
    <label class="diary-grow">
      <span class="diary-grow__label">{props.label}</span>
      <textarea
        ref={area}
        class="diary-grow__input"
        rows={3}
        maxLength={4000}
        value={props.value}
        placeholder={props.placeholder}
        onInput={(event) => {
          props.onInput(event.currentTarget.value);
          fit();
        }}
      />
    </label>
  );
}
