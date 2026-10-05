import type { CoreStatus } from '@localmed/contracts';
import {
  createMemo,
  createSignal,
  type JSX,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';

import { DownloadsPage } from '@/features/downloads/DownloadsPage';
import { ClinicianProfileSettings } from '@/features/settings/ClinicianProfileSettings';
import { ReferenceImagesPage } from '@/features/settings/ReferenceImagesPage';
import { SettingsAboutPage } from '@/features/settings/SettingsAboutPage';
import { SettingsAiPage } from '@/features/settings/SettingsAiPage';
import { SettingsAppearancePage } from '@/features/settings/SettingsAppearancePage';
import { SettingsDataPage } from '@/features/settings/SettingsDataPage';
import {
  SettingsGeneralPage,
  type SettingsGeneralPageProps,
} from '@/features/settings/SettingsGeneralPage';
import { SettingsImagesPage } from '@/features/settings/SettingsImagesPage';
import { SettingsList } from '@/features/settings/SettingsList';
import { SettingsSubpage } from '@/features/settings/SettingsSubpage';
import { type SettingsPageId, settingsPage } from '@/features/settings/settings-pages';
import {
  consumeRequestedSettingsPage,
  readSettingsRoute,
  SETTINGS_ROOT_HASH,
  type SettingsRoute,
  settingsPageHash,
  settingsParentHash,
} from '@/features/settings/settings-routing';
import { useWideLayout } from '@/features/settings/use-wide-layout';
import { peekReturnTo, RETURN_TO_EVENT } from '@/state/return-navigation';
import '@/styles/settings-list.css';

interface SettingsViewProps extends SettingsGeneralPageProps {
  readonly status: CoreStatus | undefined;
  /** Connects freshly downloaded packages to the search core. */
  readonly onContentChanged?: () => Promise<void>;
}

/** A page opened by the one-shot request (the home update notice) replaces the list entry. */
function resolveRoute(): SettingsRoute {
  const route = readSettingsRoute();
  if (route !== 'index') return route;
  const requested = consumeRequestedSettingsPage();
  if (!requested) return route;
  window.history.replaceState({ view: 'settings' }, '', settingsPageHash(requested));
  return requested;
}

/**
 * Settings in the style of the system settings of macOS and iOS: a list of large rows, each
 * opening a sub-page (`#/settings/<id>`) with the cards of that area. From 900 px the list stays
 * on the left and the open page is shown on the right.
 */
export function SettingsView(props: SettingsViewProps): JSX.Element {
  const [route, setRoute] = createSignal<SettingsRoute>(resolveRoute());
  const [returnTo, setReturnTo] = createSignal(peekReturnTo());
  const wide = useWideLayout();

  const refreshRoute = (): void => {
    const next = window.location.hash.replace(/^#\/?/u, '');
    if (next !== '' && next !== 'settings' && !next.startsWith('settings/')) return;
    const previous = route();
    const resolved = resolveRoute();
    setRoute(resolved);
    if (resolved !== previous) window.scrollTo({ top: 0, behavior: 'instant' });
  };

  onMount(() => {
    const syncReturnTo = () => {
      setReturnTo(peekReturnTo());
    };
    window.addEventListener('hashchange', refreshRoute);
    window.addEventListener(RETURN_TO_EVENT, syncReturnTo);
    onCleanup(() => {
      window.removeEventListener('hashchange', refreshRoute);
      window.removeEventListener(RETURN_TO_EVENT, syncReturnTo);
    });
  });

  /** The page shown on the right; next to the list the first page stands in for the bare list. */
  const detail = createMemo((): Exclude<SettingsRoute, 'index'> | undefined => {
    const current = route();
    if (current !== 'index') return current;
    return wide() ? 'general' : undefined;
  });
  const listVisible = () => wide() || route() === 'index';
  const selected = (): SettingsPageId | undefined => {
    const current = detail();
    if (current === undefined) return undefined;
    return current === 'reference-images' ? 'images' : current;
  };
  const pageHeading = (): 'h1' | 'h2' => (wide() ? 'h2' : 'h1');

  const frame = (id: SettingsPageId, children: () => JSX.Element, testId?: string): JSX.Element => {
    const page = settingsPage(id);
    return (
      <SettingsSubpage
        icon={page.icon}
        tone={page.tone}
        title={page.title}
        description={page.description}
        showBack={!wide()}
        backHash={SETTINGS_ROOT_HASH}
        backLabel="К настройкам"
        headingLevel={pageHeading()}
        {...(testId ? { testId } : {})}
      >
        {children()}
      </SettingsSubpage>
    );
  };

  return (
    <section
      class="settings-page settings-shell page-surface page-grain"
      classList={{ 'settings-shell--wide': wide() }}
    >
      <Show when={listVisible()}>
        <div class="settings-shell__list" classList={{ 'settings-shell__list--sticky': wide() }}>
          <SettingsList
            selected={selected()}
            returnTo={returnTo()}
            statusInputs={{
              updateReady: () => props.appUpdateReady,
              updating: () => props.appUpdating,
              checking: () => props.appUpdateChecking,
              upToDate: () => props.appUpdateUpToDate,
            }}
          />
        </div>
      </Show>
      <Show when={detail()}>
        {(current) => (
          <div class="settings-shell__detail" data-settings-detail={current()}>
            <Switch>
              <Match when={current() === 'general'}>
                {frame('general', () => (
                  <SettingsGeneralPage {...props} />
                ))}
              </Match>
              <Match when={current() === 'clinician'}>
                {frame('clinician', () => (
                  <ClinicianProfileSettings />
                ))}
              </Match>
              <Match when={current() === 'downloads'}>
                {frame(
                  'downloads',
                  () => (
                    <DownloadsPage
                      {...(props.onContentChanged
                        ? { onContentChanged: props.onContentChanged }
                        : {})}
                    />
                  ),
                  'downloads-page',
                )}
              </Match>
              <Match when={current() === 'ai'}>
                {frame('ai', () => (
                  <SettingsAiPage />
                ))}
              </Match>
              <Match when={current() === 'images'}>
                {frame('images', () => (
                  <SettingsImagesPage />
                ))}
              </Match>
              <Match when={current() === 'reference-images'}>
                <SettingsSubpage
                  icon="image-fill"
                  tone="orange"
                  title="Справочные изображения"
                  description="Иллюстрации к статьям справочника: примеры, состав набора и загрузка."
                  showBack
                  backHash={settingsParentHash('settings/images/reference') ?? SETTINGS_ROOT_HASH}
                  backLabel="К разделу «Изображения и дополнительно»"
                  headingLevel={pageHeading()}
                  testId="reference-images-page"
                >
                  <ReferenceImagesPage />
                </SettingsSubpage>
              </Match>
              <Match when={current() === 'appearance'}>
                {frame('appearance', () => (
                  <SettingsAppearancePage />
                ))}
              </Match>
              <Match when={current() === 'data'}>
                {frame('data', () => (
                  <SettingsDataPage />
                ))}
              </Match>
              <Match when={current() === 'about'}>
                {frame('about', () => (
                  <SettingsAboutPage status={props.status} />
                ))}
              </Match>
            </Switch>
          </div>
        )}
      </Show>
    </section>
  );
}
