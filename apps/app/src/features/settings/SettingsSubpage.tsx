import { type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import type { SettingsTileTone } from '@/features/settings/settings-pages';

export interface SettingsSubpageProps {
  readonly icon: AppGlyphName;
  readonly tone: SettingsTileTone;
  readonly title: string;
  readonly description: string;
  /** The back arrow is hidden when the list is visible next to the page. */
  readonly showBack: boolean;
  readonly backHash: string;
  readonly backLabel: string;
  /** `h1` when the page fills the screen, `h2` next to the list that owns the `h1`. */
  readonly headingLevel: 'h1' | 'h2';
  readonly testId?: string;
  /** Explanations of the page: a round «?» in the header opens them. */
  readonly help?: JSX.Element;
  readonly children: JSX.Element;
}

/** Shared frame of a settings sub-page: back arrow, tile, title and the page's cards. */
export function SettingsSubpage(props: SettingsSubpageProps): JSX.Element {
  return (
    <section class="settings-subpage" data-testid={props.testId}>
      <Page
        class="settings-page__heading settings-page__heading--subroute"
        navigation={
          <Show when={props.showBack}>
            <NavBack
              class="knowledge-back-button"
              aria-label={props.backLabel}
              onClick={() => {
                window.location.hash = props.backHash;
              }}
              icon={<AppGlyph name="arrow-left" class="settings-page__back-icon" />}
            />
          </Show>
        }
        icon={
          <span class={`settings-tile settings-tile--small settings-tile--${props.tone}`}>
            <AppGlyph name={props.icon} class="settings-tile__glyph" />
          </span>
        }
        title={
          <Dynamic component={props.headingLevel} class="settings-page__title">
            {props.title}
          </Dynamic>
        }
        description={props.description}
        {...(props.help !== undefined ? { help: props.help } : {})}
      />
      {props.children}
    </section>
  );
}
