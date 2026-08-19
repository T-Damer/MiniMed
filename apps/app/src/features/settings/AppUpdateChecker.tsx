import type { Accessor, JSX } from 'solid-js';
import { Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import {
  type AppUpdateProgress,
  formatAppUpdateCheckerStatus,
  formatAppUpdateLabel,
} from '@/state/app-update';
import { RELEASE_VERSION } from '../../../../../release';

export function AppUpdateChecker(props: {
  readonly ready: Accessor<boolean>;
  readonly checking: Accessor<boolean>;
  readonly updating: Accessor<boolean>;
  readonly progress: Accessor<AppUpdateProgress | undefined>;
  readonly error: Accessor<string | undefined>;
  readonly onCheck: () => void;
  readonly onActivate: () => void;
}): JSX.Element {
  const copy = () =>
    formatAppUpdateCheckerStatus({
      version: RELEASE_VERSION,
      ready: props.ready(),
      checking: props.checking(),
      updating: props.updating(),
    });

  return (
    <section
      class="settings-section settings-section--update paper-sheet"
      aria-labelledby="settings-update-heading"
    >
      <header class="settings-section__heading">
        <div class="settings-section__heading-main">
          <AppGlyph name="refresh" class="settings-section__icon" />
          <div class="settings-section__heading-copy">
            <h2 id="settings-update-heading" class="settings-section__title">
              Обновление приложения
            </h2>
            <p class="settings-section__description">{copy().body}</p>
          </div>
        </div>
      </header>

      <Show when={props.error()}>
        {(message) => (
          <p class="settings-update__error" role="alert">
            {message()}
          </p>
        )}
      </Show>

      <div class="settings-update__actions">
        <Show when={!props.updating()}>
          <Button
            type="button"
            class="settings-update__check"
            disabled={props.checking()}
            onClick={props.onCheck}
          >
            {copy().checkLabel}
          </Button>
        </Show>
        <Show when={props.ready() || props.updating()}>
          <Button
            type="button"
            variant="primary"
            class="settings-update__apply"
            disabled={props.updating()}
            onClick={props.onActivate}
          >
            {formatAppUpdateLabel(props.updating(), props.progress())}
          </Button>
        </Show>
      </div>
    </section>
  );
}
