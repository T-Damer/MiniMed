import { createUniqueId, For, type JSX, onMount, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import type { HeaderAction } from '@/components/HeaderActions';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import type { PageHero } from '@/components/PageHero';
import { Heading } from '@/components/Text';
import type { SendTone } from '@/diary/diary-home';

/**
 * Header of every patient screen: the main app's page header (`Page`) — the round back button when
 * the screen has one, the title, one description line, icon buttons on the right (they fold into
 * «⋯» when the row runs out of room) and the round «?» for explanations.
 */
export function ScreenHeader(props: {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly backLabel?: string;
  /** Absent on the screens the tab bar opens: they are not a step back from anything. */
  readonly onBack?: (() => void) | undefined;
  readonly headerActions?: readonly HeaderAction[] | undefined;
  readonly help?: JSX.Element;
  readonly helpTitle?: string;
  /** The tab screens' band (`PAGE_HEROES`); inner screens have none. */
  readonly hero?: PageHero | undefined;
}): JSX.Element {
  return (
    <Page
      class="diary-screen"
      hero={props.hero}
      navigation={
        <Show when={props.onBack}>
          {(back) => (
            <NavBack
              class="knowledge-back-button"
              aria-label={props.backLabel ?? 'На главную'}
              onClick={() => back()()}
            />
          )}
        </Show>
      }
      title={<Heading depth={1}>{props.title}</Heading>}
      description={props.subtitle}
      headerActions={props.headerActions}
      help={props.help}
      {...(props.helpTitle ? { helpTitle: props.helpTitle } : {})}
    />
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

const SKELETON_WIDTHS = [92, 78, 86, 64, 88, 72, 80, 58];

/**
 * Lines where text is still arriving inside a diary sheet. The diary bundle does not load the
 * app's shell, so this is its own small version of `SkeletonLines`.
 */
export function DiarySkeleton(props: { readonly label: string; readonly lines?: number }) {
  return (
    <div class="diary-skeleton" role="status" aria-busy="true" aria-label={props.label}>
      <For each={SKELETON_WIDTHS.slice(0, props.lines ?? 4)}>
        {(width) => (
          <span class="diary-skeleton__bar" style={{ width: `${width}%` }} aria-hidden="true" />
        )}
      </For>
    </div>
  );
}
