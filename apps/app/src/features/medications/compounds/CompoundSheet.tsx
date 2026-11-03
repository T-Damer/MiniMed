import { For, type JSX, Show } from 'solid-js';

import { OverlayDialog } from '@/components/OverlayDialog';
import type { CompoundFact } from '@/features/medications/compounds/compound-facts';
import { StructureFormula } from '@/features/medications/compounds/StructureFormula';

import '@/features/medications/compounds/compound-sheet.css';

/** Subscript digits for a molecular formula: C24H34N4O5S → C₂₄H₃₄N₄O₅S. */
function formulaText(formula: string): string {
  return formula.replace(/\d/gu, (digit) => String.fromCharCode(0x2080 + Number(digit)));
}

/** Roles come ranked, ATC-consistent ones first; the tail of the source lists is often noise. */
const MAX_ROLES = 2;

const BASIS_LABELS: Readonly<Record<CompoundFact['basis'], string>> = {
  wikidata: 'Wikidata',
  chebi: 'ChEBI',
  chembl: 'ChEMBL',
  curated: 'справочник вспомогательных веществ',
};

/** «Wikidata · ChEBI · ChEMBL»: the open sources the sheet's facts come from. */
function sourceLine(compound: CompoundFact): string {
  const names = new Set<string>([BASIS_LABELS[compound.basis]]);
  if (compound.wd) names.add('Wikidata');
  if (compound.chebi) names.add('ChEBI');
  if (compound.chembl && (compound.targets?.length ?? 0) > 0) names.add('ChEMBL');
  return [...names].join(' · ');
}

/**
 * One compound: its structure, formula and what it does — roles and molecular targets for an
 * active substance, the technological function for an excipient. From open chemistry sources
 * (Wikidata, ChEBI), named in the sheet's last line.
 */
export function CompoundSheet(props: {
  readonly compound: CompoundFact | null;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <OverlayDialog
      open={props.compound !== null}
      title={props.compound?.ru ?? ''}
      {...(props.compound?.en ? { subtitle: props.compound.en } : {})}
      class="compound-sheet"
      onClose={props.onClose}
    >
      <Show when={props.compound}>
        {(compound) => (
          <div class="compound-sheet__body" data-testid="compound-sheet">
            <Show when={compound().smiles}>
              {(smiles) => (
                <StructureFormula
                  smiles={smiles()}
                  label={`Структурная формула: ${compound().ru}`}
                  size="large"
                  class="compound-sheet__structure"
                />
              )}
            </Show>
            <Show when={compound().formula}>
              {(formula) => <p class="compound-sheet__formula">{formulaText(formula())}</p>}
            </Show>
            <Show when={(compound().functions?.length ?? 0) > 0}>
              <section class="compound-sheet__group">
                <h3 class="compound-sheet__heading">Роль в препарате</h3>
                <ul class="compound-sheet__chips">
                  <For each={compound().functions}>
                    {(item) => <li class="compound-sheet__chip">{item}</li>}
                  </For>
                </ul>
              </section>
            </Show>
            <Show when={(compound().roles?.length ?? 0) > 0}>
              <section class="compound-sheet__group">
                <h3 class="compound-sheet__heading">Как действует</h3>
                <ul class="compound-sheet__chips">
                  <For each={compound().roles?.slice(0, MAX_ROLES)}>
                    {(item) => <li class="compound-sheet__chip">{item}</li>}
                  </For>
                </ul>
              </section>
            </Show>
            <Show when={(compound().targets?.length ?? 0) > 0}>
              <section class="compound-sheet__group">
                <h3 class="compound-sheet__heading">Мишени</h3>
                <ul class="compound-sheet__targets">
                  <For each={compound().targets}>
                    {(item) => <li class="compound-sheet__target">{item}</li>}
                  </For>
                </ul>
              </section>
            </Show>
            <p class="compound-sheet__source">{sourceLine(compound())}</p>
          </div>
        )}
      </Show>
    </OverlayDialog>
  );
}
