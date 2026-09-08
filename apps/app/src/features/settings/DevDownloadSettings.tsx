import { createSignal, type JSX } from 'solid-js';

import { Switch } from '@/components/Switch';
import { usesLocalModuleArtifacts } from '@/features/modules/artifact-url';
import { loadAppPreferences, saveAppPreferences } from '@/state/app-preferences';

export function DevDownloadSettings(): JSX.Element {
  const [local, setLocal] = createSignal(usesLocalModuleArtifacts());
  return (
    <div class="settings-row">
      <div class="settings-row__text">
        <span class="settings-row__label">DEV: локальные наборы</span>
        <p class="settings-row__helper">
          {local() ? 'Источник: локальный сервер.' : 'Источник: GitHub.'} Применяется к следующим
          загрузкам наборов. Уже скачанные файлы остаются в кеше. На GitHub доступны только
          опубликованные версии.
        </p>
      </div>
      <Switch
        aria-label="DEV: локальные наборы"
        checked={local()}
        onChange={(enabled) => {
          saveAppPreferences({ ...loadAppPreferences(), devLocalModuleArtifacts: enabled });
          setLocal(enabled);
        }}
      />
    </div>
  );
}
