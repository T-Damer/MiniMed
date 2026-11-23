import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import {
  AFFINITY_TIER_LABELS,
  type DrugPharmacologyProfile,
  type ReceptorAffinityTier,
} from '@/features/medications/pharmacology/drug-pharmacology-schema';
import { lookupDrugPharmacology } from '@/features/medications/pharmacology/psychotropic-pharmacology';

import '@/features/medications/pharmacology/drug-pinned-facts.css';

type ModalTab = 'pk' | 'receptors';

function shortHalfLife(halfLife: string): string {
  const first = halfLife.split('(')[0]?.trim() ?? halfLife;
  return first.length > 22 ? `${first.slice(0, 20)}…` : first;
}

function topReceptorChipLabel(profile: DrugPharmacologyProfile): string {
  const strong = profile.receptors.filter(
    (item) => item.affinity === 'very-high' || item.affinity === 'high',
  );
  const picks = (strong.length > 0 ? strong : profile.receptors)
    .slice(0, 2)
    .map((item) => item.receptor.split(' ')[0]);
  const extra = profile.receptors.length - picks.length;
  return extra > 0 ? `${picks.join(' · ')} +${extra}` : picks.join(' · ');
}

function affinityModifier(tier: ReceptorAffinityTier): string {
  return `drug-facts-receptor--${tier}`;
}

/**
 * Compact pinned pharmacology chips right below the drug header (`t½`, receptor profile),
 * opening a detail modal on tap. Rendered generically from schema data without branching on IDs.
 */
export function DrugPinnedFacts(props: {
  readonly inn?: string | null | undefined;
  readonly fallbackTitle?: string | null | undefined;
}): JSX.Element {
  const profile = createMemo(
    () => lookupDrugPharmacology(props.inn) ?? lookupDrugPharmacology(props.fallbackTitle),
  );
  const [openTab, setOpenTab] = createSignal<ModalTab | null>(null);
  const [sourcesOpen, setSourcesOpen] = createSignal(false);

  return (
    <Show when={profile()}>
      {(facts) => (
        <>
          <fieldset class="drug-pinned-facts" aria-label="Ключевые параметры препарата">
            <button
              type="button"
              class="drug-pinned-facts__chip"
              data-testid="drug-fact-pk"
              onClick={() => setOpenTab('pk')}
            >
              <AppGlyph name="clock" class="drug-pinned-facts__icon" />
              <span class="drug-pinned-facts__label">t½ {shortHalfLife(facts().pk.halfLife)}</span>
            </button>
            <button
              type="button"
              class="drug-pinned-facts__chip drug-pinned-facts__chip--receptors"
              data-testid="drug-fact-receptors"
              onClick={() => setOpenTab('receptors')}
            >
              <AppGlyph name="brain" class="drug-pinned-facts__icon" />
              <span class="drug-pinned-facts__label">{topReceptorChipLabel(facts())}</span>
            </button>
          </fieldset>

          <OverlayDialog
            open={openTab() !== null}
            title={
              openTab() === 'pk'
                ? 'Фармакокинетика'
                : `Рецепторный профиль (${facts().receptors.length})`
            }
            onClose={() => setOpenTab(null)}
          >
            <div class="drug-facts-modal">
              <p class="drug-facts-modal__class">{facts().classLabel}</p>
              <div class="drug-facts-modal__tabs" role="tablist" aria-label="Раздел параметров">
                <button
                  type="button"
                  role="tab"
                  aria-selected={openTab() === 'receptors'}
                  class="drug-facts-modal__tab"
                  classList={{ 'drug-facts-modal__tab--active': openTab() === 'receptors' }}
                  onClick={() => setOpenTab('receptors')}
                >
                  <AppGlyph name="brain" class="drug-facts-modal__tab-icon" />
                  Рецепторы
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={openTab() === 'pk'}
                  class="drug-facts-modal__tab"
                  classList={{ 'drug-facts-modal__tab--active': openTab() === 'pk' }}
                  onClick={() => setOpenTab('pk')}
                >
                  <AppGlyph name="clock" class="drug-facts-modal__tab-icon" />
                  Фармакокинетика
                </button>
              </div>

              <Show when={openTab() === 'pk'}>
                <dl class="drug-facts-pk">
                  <div class="drug-facts-pk__row">
                    <dt class="drug-facts-pk__term">Период полувыведения (t½)</dt>
                    <dd class="drug-facts-pk__value">{facts().pk.halfLife}</dd>
                  </div>
                  <Show when={facts().pk.tmax}>
                    {(tmax) => (
                      <div class="drug-facts-pk__row">
                        <dt class="drug-facts-pk__term">Tmax (пик в плазме)</dt>
                        <dd class="drug-facts-pk__value">{tmax()}</dd>
                      </div>
                    )}
                  </Show>
                  <Show when={facts().pk.metabolism}>
                    {(metabolism) => (
                      <div class="drug-facts-pk__row">
                        <dt class="drug-facts-pk__term">Метаболизм</dt>
                        <dd class="drug-facts-pk__value">{metabolism()}</dd>
                      </div>
                    )}
                  </Show>
                  <Show when={facts().pk.steadyState}>
                    {(steady) => (
                      <div class="drug-facts-pk__row">
                        <dt class="drug-facts-pk__term">Равновесная концентрация</dt>
                        <dd class="drug-facts-pk__value">{steady()}</dd>
                      </div>
                    )}
                  </Show>
                  <Show when={facts().pk.activeMetabolites}>
                    {(metabolites) => (
                      <div class="drug-facts-pk__row">
                        <dt class="drug-facts-pk__term">Активные метаболиты</dt>
                        <dd class="drug-facts-pk__value">{metabolites()}</dd>
                      </div>
                    )}
                  </Show>
                </dl>
              </Show>

              <Show when={openTab() === 'receptors'}>
                <ul class="drug-facts-receptors">
                  <For each={facts().receptors}>
                    {(binding) => (
                      <li class={`drug-facts-receptor ${affinityModifier(binding.affinity)}`}>
                        <div class="drug-facts-receptor__top">
                          <strong class="drug-facts-receptor__name">{binding.receptor}</strong>
                          <span class="drug-facts-receptor__tier">
                            {AFFINITY_TIER_LABELS[binding.affinity]}
                            <Show when={binding.kiNm}>{(ki) => ` · Ki ${ki()}`}</Show>
                          </span>
                        </div>
                        <p class="drug-facts-receptor__action">{binding.action}</p>
                        <p class="drug-facts-receptor__pathway">
                          <span class="drug-facts-receptor__label">Путь / зона: </span>
                          {binding.pathway}
                        </p>
                        <p class="drug-facts-receptor__effect">{binding.clinicalEffect}</p>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>

              <div class="drug-facts-sources">
                <button
                  type="button"
                  class="drug-facts-sources__toggle"
                  aria-expanded={sourcesOpen()}
                  onClick={() => setSourcesOpen((prev) => !prev)}
                >
                  <span class="drug-facts-sources__toggle-label">
                    Источники ({facts().sources.length})
                  </span>
                  <AppGlyph
                    name={sourcesOpen() ? 'caret-up' : 'caret-down'}
                    class="drug-facts-sources__toggle-icon"
                  />
                </button>
                <Show when={sourcesOpen()}>
                  <ul class="drug-facts-sources__list">
                    <For each={facts().sources}>
                      {(source) => (
                        <li class="drug-facts-sources__item">
                          <span class="drug-facts-sources__title">{source.title}</span>
                          <span class="drug-facts-sources__meta">
                            {source.publisher}, {source.year}
                          </span>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </div>
            </div>
          </OverlayDialog>
        </>
      )}
    </Show>
  );
}
