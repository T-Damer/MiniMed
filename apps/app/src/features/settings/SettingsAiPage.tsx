import type { JSX } from 'solid-js';

import { AsrSettings } from '@/features/asr/AsrSettings';
import { SemanticSearchSettings } from '@/features/semantic/SemanticSearchSettings';
import { EcgModelSettings } from '@/features/settings/EcgModelSettings';

/** «Функции ИИ»: search by meaning, speech recognition and ECG recognition, each with its state. */
export function SettingsAiPage(): JSX.Element {
  return (
    <>
      <p class="settings-subpage__hint">
        Скачиваются по желанию, один раз, и дальше работают на устройстве без интернета. Запросы и
        записи никуда не отправляются.
      </p>
      <SemanticSearchSettings />
      <AsrSettings />
      <EcgModelSettings />
    </>
  );
}
