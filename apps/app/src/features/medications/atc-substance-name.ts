import { loadAtcDirectoryEntries } from '@/features/drug-comparison/comparison-atc-directory';
import { displayDrugName } from '@/features/medications/drug-screen';

const SUBSTANCE_NAMES_SHOWN = 3;

/**
 * The substances that carry exactly this full code, as their names read («умифеновир»): the level-5
 * name of a code met in a text, where no drug card stands behind it. Null when no card has the code.
 */
export async function atcSubstanceName(code: string): Promise<string | null> {
  const names = (await loadAtcDirectoryEntries())
    .filter((entry) => entry.codes.includes(code))
    .map((entry) => displayDrugName(entry.name))
    .toSorted((left, right) => left.localeCompare(right, 'ru'));
  return names.length === 0 ? null : names.slice(0, SUBSTANCE_NAMES_SHOWN).join(', ');
}
