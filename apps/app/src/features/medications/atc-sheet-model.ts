import {
  type AtcLadderStep,
  type AtcNameCatalog,
  atcLadder,
  normalizeAtcCode,
} from '@/features/medications/atc-code';
import { type DrugAtcCode, drugAtcCodeLabel } from '@/features/medications/drug-screen';

/** One code broken into its levels: the drug's code, or the registry's stub beside an agreed code. */
export interface AtcSheetSection {
  readonly key: 'main' | 'registry';
  /** «В реестре: L03AX» over the second ladder; null over the first. */
  readonly heading: string | null;
  readonly steps: readonly AtcLadderStep[];
}

/**
 * The ladders the code sheet shows (ATC5). The code itself, level by level; where it is an agreed code
 * beside a registry stub (ATC3, «J05AX13 · в реестре: L03AX») the stub follows with its own levels, so
 * both codes can be followed into their groups. `substanceName` names level 5 when the code carries
 * none (a code met in a text: the substances that have it).
 */
export function atcSheetSections(input: {
  readonly code: DrugAtcCode;
  readonly catalog?: AtcNameCatalog | null | undefined;
  readonly substanceName?: string | null | undefined;
}): readonly AtcSheetSection[] {
  const { code } = input;
  const normalized = normalizeAtcCode(code.code);
  if (!normalized) return [];
  const sections: AtcSheetSection[] = [
    {
      key: 'main',
      heading: null,
      steps: atcLadder({
        code: normalized,
        catalog: input.catalog,
        // The group text of the node describes the registry's stub, not an agreed code's levels.
        groupText: code.consensusSources.length > 0 ? null : code.groupText,
        substanceName: code.substanceName ?? input.substanceName ?? null,
      }),
    },
  ];
  const registry = drugAtcCodeLabel(code).registryCode;
  const registryCode = registry ? normalizeAtcCode(registry) : null;
  if (registryCode && registryCode.code !== normalized.code) {
    sections.push({
      key: 'registry',
      heading: `В реестре: ${registryCode.code}`,
      steps: atcLadder({
        code: registryCode,
        catalog: input.catalog,
        groupText: code.groupText,
      }).filter((step) => step.code !== null),
    });
  }
  return sections;
}
