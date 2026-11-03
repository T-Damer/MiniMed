/**
 * Which compounds a drug card can explain (DRUG-HDR2, owner 2026-11-03): the active substance in the
 * header, and the components named in «Состав». Pure: the reader passes the loaded index.
 */
import type { DrugScreenModel } from '@/features/medications/drug-screen';
import { type CompositionRole, splitCompositionItems } from './composition-items';
import {
  type CompoundFact,
  type CompoundIndex,
  lookupCompound,
  lookupCompoundByText,
  lookupCompoundsByAtc,
} from './compound-facts';

const ATC_SUBSTANCE_LEVEL = 5;

function isActive(compound: CompoundFact): boolean {
  return compound.kind === 'active' || compound.kind === 'both';
}

/**
 * The active substance of a drug card, when it is one compound with a known structure: by the
 * substance's name first, then by its ATC code when that code names exactly one compound. A
 * combination (two substances, or an ATC code shared by several) gets none.
 */
export function drugActiveCompound(
  index: CompoundIndex,
  screen: DrugScreenModel | null,
  /** The instruction's own МНН (`metadata.inn`), for an instruction opened without its ЕСКЛП card. */
  inn: string | null = null,
): CompoundFact | null {
  const names = [
    screen?.links.substance?.label,
    screen?.header.kind === 'substance' ? screen.header.title : undefined,
    inn ?? undefined,
  ].filter((name): name is string => Boolean(name));
  for (const name of names) {
    if (/\s\+\s|,/u.test(name)) return null;
    const found = lookupCompound(index, name);
    if (found && isActive(found) && found.smiles) return found;
  }
  if (!screen) return null;
  const codes = screen.links.atc.filter((atc) => atc.level === ATC_SUBSTANCE_LEVEL);
  if (codes.length !== 1) return null;
  const [code] = codes;
  if (!code) return null;
  const byCode = lookupCompoundsByAtc(index, code.code).filter(
    (compound) => isActive(compound) && compound.smiles,
  );
  return byCode.length === 1 ? (byCode[0] ?? null) : null;
}

export interface CompositionComponent {
  readonly compound: CompoundFact;
  /** The name as the instruction writes it. */
  readonly text: string;
  readonly role: CompositionRole;
}

/** The components of a «Состав» text the index knows, each once, in the order they are named. */
export function compositionComponents(
  index: CompoundIndex,
  text: string,
): readonly CompositionComponent[] {
  const seen = new Set<string>();
  const components: CompositionComponent[] = [];
  for (const item of splitCompositionItems(text)) {
    const compound = lookupCompoundByText(index, item.text);
    if (!compound || seen.has(compound.key)) continue;
    seen.add(compound.key);
    components.push({ compound, text: item.text, role: item.role });
  }
  return components;
}

/** The one-word answer to «what is it for» on a component chip. */
export function componentRoleLabel(component: CompositionComponent): string | null {
  if (component.role === 'active') return 'действующее';
  return component.compound.functions?.[0] ?? null;
}
