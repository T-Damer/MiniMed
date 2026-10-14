import type { JSX } from 'solid-js';

import {
  instructionGroupTitle,
  instructionOfferSubtitle,
} from '@/features/medications/instruction-offer';
import { ModuleDownloadOffer } from '@/features/modules/ModuleDownloadOffer';

/**
 * «Скачать · 37 МБ» with the instruction group under it: queues the instruction module that holds
 * the instruction the card needs, through the same module runtime as every other download. Mounted
 * only where the instruction is missing, so the module catalog is not loaded for a card that has
 * what it needs. Its state is the shared download state, so a download started earlier shows its
 * progress at once.
 */
export function SafetyDownloadOffer(props: {
  readonly moduleId: string;
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  return (
    <ModuleDownloadOffer
      moduleId={props.moduleId}
      onContentChanged={props.onContentChanged}
      subtitle={(module) =>
        instructionOfferSubtitle({ groupTitle: instructionGroupTitle(module.title) })
      }
      class="safety-card__offer"
      buttonClass="safety-card__offer-button"
      testId="safety-download-offer"
      unavailableText="Инструкции этой группы пока нельзя скачать в этой версии приложения."
    />
  );
}
