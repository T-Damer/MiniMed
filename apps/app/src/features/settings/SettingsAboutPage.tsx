import type { CoreStatus } from '@localmed/contracts';
import { type JSX, Show } from 'solid-js';

import { Disclosure } from '@/components/Disclosure';
import { ReleaseLinks } from '@/components/ReleaseLinks';
import { StatusPanel } from '@/features/status/StatusPanel';

/** «О приложении»: technical information of the search core and the project links. */
export function SettingsAboutPage(props: { readonly status: CoreStatus | undefined }): JSX.Element {
  return (
    <>
      <Disclosure class="system-technical-panel" title="Техническая информация">
        <Show
          when={props.status}
          fallback={
            <p class="settings-section__description">
              Ядро поиска ещё не готово. Файлы и настройки доступны.
            </p>
          }
        >
          {(status) => <StatusPanel initialStatus={status()} />}
        </Show>
      </Disclosure>
      <nav class="settings-page__links" aria-label="Ссылки приложения">
        <ReleaseLinks linkClass="settings-page__link" />
      </nav>
    </>
  );
}
