import { createMemo, createSignal, For, type JSX, onMount, Show } from 'solid-js';
import { HorizontalScroller } from '@/components/HorizontalScroller';

import type { DrugScreenModel } from '@/features/medications/drug-screen';
import { CompoundSheet } from './CompoundSheet';
import { type CompoundFact, type CompoundIndex, loadCompoundFacts } from './compound-facts';
import { componentRoleLabel, compositionComponents, drugActiveCompound } from './drug-compounds';
import { StructureFormula } from './StructureFormula';

import '@/features/medications/compounds/drug-compounds.css';

/** The compound index, loaded the first time a drug card shows; null until then or if it failed. */
function useCompoundIndex(): () => CompoundIndex | null {
  const [index, setIndex] = createSignal<CompoundIndex | null>(null);
  onMount(() => {
    loadCompoundFacts().then(setIndex, (error: unknown) => {
      console.error('Compound facts failed to load', error);
    });
  });
  return index;
}

/**
 * Beside a drug's title: its active substance drawn as a small structure; a tap opens what the
 * compound is and does. Nothing for a combination or a substance without a known structure.
 */
export function DrugCompoundAside(props: {
  readonly screen: DrugScreenModel | null;
  readonly inn: string | null;
}): JSX.Element {
  const index = useCompoundIndex();
  const [open, setOpen] = createSignal(false);
  const compound = createMemo(() => {
    const loaded = index();
    return loaded ? drugActiveCompound(loaded, props.screen, props.inn) : null;
  });
  return (
    <Show when={compound()}>
      {(found) => (
        <>
          <button
            type="button"
            class="drug-compound-thumb"
            aria-label={`Структура: ${found().ru}`}
            title="Структурная формула"
            data-testid="drug-compound-thumb"
            onClick={() => setOpen(true)}
          >
            <StructureFormula
              smiles={found().smiles ?? ''}
              label={`Структурная формула: ${found().ru}`}
              class="drug-compound-thumb__structure"
            />
          </button>
          <CompoundSheet compound={open() ? found() : null} onClose={() => setOpen(false)} />
        </>
      )}
    </Show>
  );
}

/**
 * Under «Состав»: every component the instruction names that the index knows, with what it is
 * there for («наполнитель», «разрыхлитель», «действующее»); a tap opens the compound.
 */
export function CompositionComponents(props: { readonly text: string }): JSX.Element {
  const index = useCompoundIndex();
  const [open, setOpen] = createSignal<CompoundFact | null>(null);
  const components = createMemo(() => {
    const loaded = index();
    return loaded ? compositionComponents(loaded, props.text) : [];
  });
  return (
    <Show when={components().length > 0}>
      <HorizontalScroller
        class="composition-components"
        viewportClass="composition-components__viewport"
        controls
        hideScrollbar
        controlLabel="компоненты"
      >
        <ul class="composition-components__list" data-testid="composition-components">
          <For each={components()}>
            {(component) => (
              <li class="composition-components__cell">
                <button
                  type="button"
                  class="composition-components__chip"
                  classList={{
                    'composition-components__chip--active': component.role === 'active',
                  }}
                  onClick={() => setOpen(component.compound)}
                >
                  <span class="composition-components__name">{component.compound.ru}</span>
                  <Show when={componentRoleLabel(component)}>
                    {(label) => <span class="composition-components__role">{label()}</span>}
                  </Show>
                </button>
              </li>
            )}
          </For>
        </ul>
      </HorizontalScroller>
      <CompoundSheet compound={open()} onClose={() => setOpen(null)} />
    </Show>
  );
}
