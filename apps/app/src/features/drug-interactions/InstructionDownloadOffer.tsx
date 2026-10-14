import type { JSX } from 'solid-js';

import {
  instructionGroupTitle,
  instructionOfferSubtitle,
} from '@/features/medications/instruction-offer';
import { ModuleDownloadOffer } from '@/features/modules/ModuleDownloadOffer';

/**
 * «Скачать · 37 МБ» with the instruction group under it: queues the instruction module that holds
 * a drug's instruction through the same module runtime as every other download. Mounted only
 * where an instruction is missing, so the module catalog is not loaded for a tool that has
 * everything it needs; one offer per module however many pairs or columns ask for it.
 */
export function InstructionDownloadOffer(props: {
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
      class="drug-interactions__offer"
      buttonClass="drug-interactions__offer-button"
      unavailableText="Инструкции этой группы пока нельзя скачать в этой версии приложения."
    />
  );
}
