import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Page } from '@/components/Page';
import { SearchField } from '@/components/SearchField';
import {
  filterSettingsPages,
  SETTINGS_GROUPS,
  type SettingsPageDefinition,
  type SettingsPageId,
  settingsPage,
} from '@/features/settings/settings-pages';
import { settingsPageHash } from '@/features/settings/settings-routing';
import type { SettingsStatuses } from '@/features/settings/settings-status';
import {
  type SettingsStatusInputs,
  useSettingsStatuses,
} from '@/features/settings/use-settings-statuses';
import {
  consumeAndRestoreReturnTo,
  type ReturnToLocation,
  returnToControlIcon,
  returnToControlLabel,
} from '@/state/return-navigation';

export interface SettingsListProps {
  readonly selected: SettingsPageId | undefined;
  readonly returnTo: ReturnToLocation | null;
  readonly statusInputs: SettingsStatusInputs;
}

function SettingsRow(props: {
  readonly page: SettingsPageDefinition;
  readonly statuses: () => SettingsStatuses;
  readonly selected: boolean;
  readonly divided: boolean;
}): JSX.Element {
  const status = () => props.statuses()[props.page.id];
  return (
    <li class="settings-list__item">
      <a
        class="settings-list__row"
        classList={{
          'settings-list__row--selected': props.selected,
          'settings-list__row--divided': props.divided,
        }}
        href={settingsPageHash(props.page.id)}
        aria-current={props.selected ? 'page' : undefined}
        data-settings-page={props.page.id}
      >
        <span class={`settings-tile settings-tile--${props.page.tone}`}>
          <AppGlyph name={props.page.icon} class="settings-tile__glyph" />
        </span>
        <span class="settings-list__title">{props.page.title}</span>
        <span class={`settings-list__status settings-list__status--${status().tone}`}>
          <span
            class={`settings-list__dot settings-list__dot--${status().tone}`}
            aria-hidden="true"
          />
          <span class="settings-list__status-text" data-testid={`settings-status-${props.page.id}`}>
            {status().label}
          </span>
        </span>
        <AppGlyph name="caret-right" class="settings-list__chevron" aria-hidden="true" />
      </a>
    </li>
  );
}

/** The top level of Settings: inset groups of large rows with a coloured tile, a status and a chevron. */
export function SettingsList(props: SettingsListProps): JSX.Element {
  const statuses = useSettingsStatuses(props.statusInputs);
  const [query, setQuery] = createSignal('');
  const filtering = () => query().trim() !== '';
  const matches = () => filterSettingsPages(query());
  return (
    <div class="settings-list">
      <Page
        class="settings-page__heading"
        navigation={
          <Show when={props.returnTo}>
            {(returnTo) => (
              <Button
                type="button"
                variant="icon"
                class="knowledge-back-button return-navigation-button settings-page__return"
                aria-label={returnToControlLabel(returnTo())}
                title={returnToControlLabel(returnTo())}
                onClick={() => consumeAndRestoreReturnTo()}
                icon={<AppGlyph name={returnToControlIcon(returnTo())} />}
              />
            )}
          </Show>
        }
        icon={<AppGlyph name="system" class="page__icon-glyph" />}
        title={<h1 class="settings-page__title">Настройки</h1>}
        description="Обновления, загрузки, ИИ, внешний вид."
      />
      <SearchField
        class="settings-list__search"
        value={query()}
        onInput={setQuery}
        onClear={() => setQuery('')}
        label="Найти настройку"
        hideLabel
        placeholder="Найти настройку"
        autocomplete="off"
      />
      <Show
        when={!filtering()}
        fallback={
          <Show
            when={matches().length > 0}
            fallback={
              <p class="settings-list__empty">Ничего не нашлось. Попробуйте другое слово.</p>
            }
          >
            <ul class="settings-list__group" aria-label="Найденные разделы">
              <For each={matches()}>
                {(page, index) => (
                  <SettingsRow
                    page={page}
                    statuses={statuses}
                    selected={props.selected === page.id}
                    divided={index() > 0}
                  />
                )}
              </For>
            </ul>
          </Show>
        }
      >
        <For each={SETTINGS_GROUPS}>
          {(group) => (
            <ul class="settings-list__group">
              <For each={group}>
                {(id, index) => (
                  <SettingsRow
                    page={settingsPage(id)}
                    statuses={statuses}
                    selected={props.selected === id}
                    divided={index() > 0}
                  />
                )}
              </For>
            </ul>
          )}
        </For>
      </Show>
    </div>
  );
}
