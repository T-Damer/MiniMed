import { createUniqueId, type JSX, onMount, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import type { SendTone } from '@/diary/diary-home';

/**
 * Header of every step after the diary home: a big «назад», what this page is, and which diary.
 * Focus moves to the title when the page opens, so a screen reader announces where the patient is.
 */
export function ScreenHeader(props: {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly backLabel?: string;
  readonly onBack: () => void;
}): JSX.Element {
  let title: HTMLHeadingElement | undefined;
  onMount(() => title?.focus({ preventScroll: true }));
  return (
    <header class="diary-screen">
      <Button
        class="diary-screen__back"
        type="button"
        variant="quiet"
        icon={<AppGlyph name="arrow-left" class="diary-screen__back-icon" />}
        onClick={props.onBack}
      >
        {props.backLabel ?? 'На главную'}
      </Button>
      <h1 class="diary-screen__title" tabindex="-1" ref={title}>
        {props.title}
      </h1>
      <Show when={props.subtitle}>
        <p class="diary-screen__subtitle">{props.subtitle}</p>
      </Show>
    </header>
  );
}

/**
 * One of the three things a patient does with the diary. A whole-width button: a plain verb, an
 * icon, and below it the state in words. The accessible name is the verb, the state its description.
 */
export function ActionCard(props: {
  readonly icon: AppGlyphName;
  readonly title: string;
  readonly status?: string | undefined;
  readonly tone?: SendTone | 'plain';
  readonly primary?: boolean;
  /** The button opens a panel on the same page. */
  readonly expanded?: boolean;
  /** An arrow at the end says «this opens another page»; a choice on the same page has none. */
  readonly chevron?: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  const id = createUniqueId();
  const tone = (): SendTone | 'plain' => props.tone ?? 'plain';
  return (
    <button
      type="button"
      class="diary-action"
      classList={{
        'diary-action--primary': props.primary ?? false,
        'diary-action--pending': tone() === 'pending',
        'diary-action--done': tone() === 'done',
      }}
      aria-labelledby={`${id}-title`}
      aria-describedby={props.status ? `${id}-status` : undefined}
      aria-expanded={props.expanded}
      onClick={props.onClick}
    >
      <span
        class="diary-action__icon"
        classList={{ 'diary-action__icon--primary': props.primary ?? false }}
      >
        <AppGlyph name={props.icon} class="diary-action__glyph" />
      </span>
      <span class="diary-action__text">
        <span class="diary-action__title" id={`${id}-title`}>
          {props.title}
        </span>
        <Show when={props.status}>
          <span class="diary-action__status" id={`${id}-status`}>
            {props.status}
          </span>
        </Show>
      </span>
      <Show when={props.chevron ?? true}>
        <AppGlyph name="caret-right" class="diary-action__chevron" />
      </Show>
    </button>
  );
}

/** «Запись сохранена»: what was saved, in the patient's words, and what to do next. */
export function SavedBanner(props: {
  readonly heading: string;
  readonly line: string;
  readonly when: string;
  readonly hint?: string | undefined;
}): JSX.Element {
  return (
    <section class="diary-saved" role="status" aria-label="Запись сохранена">
      <AppGlyph name="check" class="diary-saved__icon" />
      <div class="diary-saved__body">
        <p class="diary-saved__heading">{props.heading}</p>
        <p class="diary-saved__line">{props.line}</p>
        <p class="diary-saved__when">{props.when}</p>
        <Show when={props.hint}>
          <p class="diary-saved__hint">{props.hint}</p>
        </Show>
      </div>
    </section>
  );
}
