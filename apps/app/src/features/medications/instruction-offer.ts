import type { ContentModuleCatalogEntry } from '@localmed/contracts';

import {
  EAEU_INSTRUCTION_MODULE_ID,
  instructionModuleIdForSubstanceModule,
} from '@/features/medications/instruction-source';
import { formatModuleBytes } from '@/features/modules/module-display';

/** The download that would add the official instruction of a drug the app shows without one. */
export interface InstructionModuleOffer {
  readonly moduleId: string;
  /** «Нервная система», the group the module covers. */
  readonly groupTitle: string;
  readonly downloadBytes: number | null;
  /** The line under the button when the module is not a group's («Инструкции ЕАЭС …»). */
  readonly subtitle?: string;
}

const EAEU_OFFER_SUBTITLE = 'Инструкции ЕАЭС из реестров Беларуси и Казахстана';

const MODULE_TITLE_PREFIX = 'Инструкции ГРЛС — ';

/**
 * The instruction module of the substance's ATC group, when the catalog lists it, the app may
 * install it now and it is not installed. Once the group's module is installed and the text is
 * still missing, the EAEU module of the Belarus and Kazakhstan registers (when not installed). Null
 * otherwise: nothing to offer (this registration then simply has no official text on the device).
 */
export function instructionModuleOffer(input: {
  readonly substanceModuleId: string | null;
  readonly catalogModules: readonly Pick<
    ContentModuleCatalogEntry,
    'id' | 'title' | 'sizes' | 'releaseState' | 'artifacts' | 'sourceSetDigest'
  >[];
  readonly installedModuleIds: ReadonlySet<string>;
  readonly isReleased: (
    module: Pick<ContentModuleCatalogEntry, 'releaseState' | 'artifacts' | 'sourceSetDigest'>,
  ) => boolean;
}): InstructionModuleOffer | null {
  const moduleId = input.substanceModuleId
    ? instructionModuleIdForSubstanceModule(input.substanceModuleId)
    : null;
  if (!moduleId) return null;
  if (input.installedModuleIds.has(moduleId)) {
    if (input.installedModuleIds.has(EAEU_INSTRUCTION_MODULE_ID)) return null;
    const eaeu = input.catalogModules.find((entry) => entry.id === EAEU_INSTRUCTION_MODULE_ID);
    if (!eaeu || !input.isReleased(eaeu)) return null;
    return {
      moduleId: EAEU_INSTRUCTION_MODULE_ID,
      groupTitle: eaeu.title,
      downloadBytes: eaeu.sizes.downloadBytes,
      subtitle: EAEU_OFFER_SUBTITLE,
    };
  }
  const module = input.catalogModules.find((entry) => entry.id === moduleId);
  if (!module || !input.isReleased(module)) return null;
  return {
    moduleId,
    groupTitle: instructionGroupTitle(module.title),
    downloadBytes: module.sizes.downloadBytes,
  };
}

/** The button: «Скачать · 24 МБ». What it downloads is the {@link instructionOfferSubtitle}. */
export function instructionOfferLabel(offer: InstructionModuleOffer): string {
  const size = offer.downloadBytes === null ? '' : ` · ${formatModuleBytes(offer.downloadBytes)}`;
  return `Скачать${size}`;
}

/** The small line under the button: «Инструкции группы «Нервная система»». */
export function instructionOfferSubtitle(
  offer: Pick<InstructionModuleOffer, 'groupTitle' | 'subtitle'>,
): string {
  return offer.subtitle ?? `Инструкции группы «${offer.groupTitle}»`;
}

/** The group a module of the instruction catalog covers, without the «Инструкции ГРЛС — » prefix. */
export function instructionGroupTitle(moduleTitle: string): string {
  return moduleTitle.startsWith(MODULE_TITLE_PREFIX)
    ? moduleTitle.slice(MODULE_TITLE_PREFIX.length)
    : moduleTitle;
}

/** «…показана краткая справка Allmed» (or «Видаль», «Allmed и Видаль»: the sources on screen). */
export function instructionUnavailableNotice(sourceLabel: string): string {
  return `Полная официальная инструкция пока недоступна — показана краткая справка ${sourceLabel}.`;
}

export const INSTRUCTION_UNAVAILABLE_NOTICE = instructionUnavailableNotice('Allmed');
