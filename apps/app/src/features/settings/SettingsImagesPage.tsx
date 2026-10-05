import { createSignal, type JSX, onCleanup, onMount } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Switch } from '@/components/Switch';
import { PackagingImagesSettings } from '@/features/settings/PackagingImagesSettings';
import { SETTINGS_REFERENCE_IMAGES_HASH } from '@/features/settings/settings-routing';
import { useReferenceImagesStatus } from '@/features/settings/use-settings-statuses';
import {
  getExperimentalModulesEnabled,
  setExperimentalModulesEnabled,
  subscribeAppPreferences,
} from '@/state/app-preferences';

/**
 * «Изображения и дополнительно»: the reference images (own sub-page with examples), the packaging
 * images module and the switch for preliminary materials.
 */
export function SettingsImagesPage(): JSX.Element {
  const referenceStatus = useReferenceImagesStatus();
  const [experimental, setExperimental] = createSignal(getExperimentalModulesEnabled());
  onMount(() => {
    const unsubscribe = subscribeAppPreferences((preferences) =>
      setExperimental(preferences.experimentalModulesEnabled),
    );
    onCleanup(unsubscribe);
  });
  return (
    <>
      <ul class="settings-list__group" aria-label="Иллюстрации">
        <li class="settings-list__item">
          <a class="settings-list__row" href={SETTINGS_REFERENCE_IMAGES_HASH}>
            <span class="settings-tile settings-tile--orange">
              <AppGlyph name="image-fill" class="settings-tile__glyph" />
            </span>
            <span class="settings-list__title">Справочные изображения</span>
            <span class={`settings-list__status settings-list__status--${referenceStatus().tone}`}>
              <span
                class={`settings-list__dot settings-list__dot--${referenceStatus().tone}`}
                aria-hidden="true"
              />
              <span
                class="settings-list__status-text"
                data-testid="settings-status-reference-images"
              >
                {referenceStatus().label}
              </span>
            </span>
            <AppGlyph name="caret-right" class="settings-list__chevron" aria-hidden="true" />
          </a>
        </li>
      </ul>
      <p class="settings-subpage__hint">
        Иллюстрации к статьям справочника: примеры, состав набора и загрузка.
      </p>
      <PackagingImagesSettings />
      <section
        class="settings-section settings-section--experimental paper-sheet"
        aria-label="Предварительные материалы"
      >
        <div class="settings-row">
          <div class="settings-row__text">
            <span class="settings-row__label settings-row__label--with-icon">
              <AppGlyph name="flask" class="settings-row__label-icon" aria-hidden="true" />
              Предварительные материалы
            </span>
            <p class="settings-row__helper">
              Показывать черновые наборы препаратов, калькуляторов, опросников и словарь терминов.
              Они могут быть неполными и ещё меняться.
            </p>
          </div>
          <Switch
            checked={experimental()}
            aria-label="Предварительные материалы"
            onChange={(checked) => setExperimentalModulesEnabled(checked)}
          />
        </div>
      </section>
    </>
  );
}
