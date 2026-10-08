import type { JSX } from 'solid-js';

import { AsrSettings } from '@/features/asr/AsrSettings';
import { OcrSettings } from '@/features/ocr/OcrSettings';
import { SemanticSearchSettings } from '@/features/semantic/SemanticSearchSettings';
import { EcgModelSettings } from '@/features/settings/EcgModelSettings';

/** The header «?» of «Функции ИИ»: what downloading a model means. */
export function SettingsAiHelp(): JSX.Element {
  return (
    <p>
      Модели скачиваются по желанию, один раз, и дальше работают на устройстве без интернета.
      Запросы и записи никуда не отправляются.
    </p>
  );
}

/** «Функции ИИ»: search by meaning, speech, ECG and text recognition (OCR), each with its state. */
export function SettingsAiPage(): JSX.Element {
  return (
    <>
      <SemanticSearchSettings />
      <AsrSettings />
      <EcgModelSettings />
      <OcrSettings />
    </>
  );
}
