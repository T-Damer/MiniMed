import type { ContentModuleCatalogEntry } from '@localmed/contracts';

import { instructionModuleIdForSubstanceModule } from '@/features/medications/instruction-source';
import { formatModuleBytes } from '@/features/modules/module-display';

/** The download that would add the official instruction of a drug the app shows without one. */
export interface InstructionModuleOffer {
  readonly moduleId: string;
  /** «Нервная система», the group the module covers. */
  readonly groupTitle: string;
  readonly downloadBytes: number | null;
}

const MODULE_TITLE_PREFIX = 'Инструкции ГРЛС — ';

/**
 * The instruction module of the substance's ATC group, when the catalog lists it, the app may
 * install it now and it is not installed. Null otherwise: nothing to offer, either because the
 * group's instructions are already installed (this registration then simply has no official text
 * there) or because no such module is available.
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
  if (!moduleId || input.installedModuleIds.has(moduleId)) return null;
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
  offer: Pick<InstructionModuleOffer, 'groupTitle'>,
): string {
  return `Инструкции группы «${offer.groupTitle}»`;
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
