import type { JSX } from 'solid-js';

import { ModuleDownloadOffer } from '@/features/modules/ModuleDownloadOffer';
import { SEVERITY_MODULE_ID } from './interaction-severity';

/**
 * «Скачать · 2 МБ» under which «Метки степени риска» stand: the optional DDInter module, queued
 * through the same module runtime as every other download. Mounted only where a pair has
 * instruction sentences and the module is missing, so the catalog is not loaded for a tool that
 * has nothing to offer.
 */
export function SeverityDownloadOffer(props: {
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  return (
    <ModuleDownloadOffer
      moduleId={SEVERITY_MODULE_ID}
      onContentChanged={props.onContentChanged}
      failureMessage="Не удалось скачать метки."
      subtitle={() => 'Метки степени риска'}
      variant="secondary"
      class="drug-interactions__severity-offer"
      buttonClass="drug-interactions__severity-offer-button"
      testId="severity-offer"
      buttonTestId="severity-offer-button"
      ariaLabel="Скачать метки степени риска"
      unavailableText="Метки степени риска пока нельзя скачать в этой версии приложения."
    />
  );
}
