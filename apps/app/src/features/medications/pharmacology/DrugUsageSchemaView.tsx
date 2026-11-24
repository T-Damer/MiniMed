import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import type { ClinicalMedicationLink } from '@/features/medications/clinical-medication-links';
import {
  type DrugPharmacologyProfile,
  type DrugRegimenBranch,
  effectiveRegimenBranches,
  REGIMEN_PATIENT_GROUP_LABELS,
  type RegimenPatientGroup,
} from '@/features/medications/pharmacology/drug-pharmacology-schema';

/**
 * Interactive block-schema view mode for drug usage protocols (start → titration → maintenance →
 * taper) grouped by patient cohort & route, paired with live Russian Clinical Recommendations (КР)
 * that reference this INN. Purely schema-driven (AGENTS.md «Schema first»).
 */
export function DrugUsageSchemaView(props: {
  readonly profile: DrugPharmacologyProfile;
  readonly clinicalLinks?: readonly ClinicalMedicationLink[] | undefined;
  readonly onOpenRecommendation?: ((link: ClinicalMedicationLink) => void) | undefined;
}): JSX.Element {
  const branches = createMemo(() => effectiveRegimenBranches(props.profile));
  const [activeGroup, setActiveGroup] = createSignal<RegimenPatientGroup>('all');

  const availableGroups = createMemo<readonly RegimenPatientGroup[]>(() => {
    const groups = new Set<RegimenPatientGroup>();
    for (const branch of branches()) {
      groups.add(branch.group);
    }
    if (groups.size <= 1) return [];
    const ordered: RegimenPatientGroup[] = ['all', 'adult', 'child', 'elderly', 'acute'];
    return ordered.filter((group) => group === 'all' || groups.has(group));
  });

  const visibleBranches = createMemo<readonly DrugRegimenBranch[]>(() => {
    const filter = activeGroup();
    const list = branches();
    if (filter === 'all') return list;
    const matched = list.filter((branch) => branch.group === filter);
    return matched.length > 0 ? matched : list;
  });

  const krLinks = () => props.clinicalLinks ?? [];

  return (
    <div class="drug-schema" data-testid="drug-usage-schema">
      <Show when={krLinks().length > 0}>
        <section class="drug-schema__kr" aria-label="Применение в клинических рекомендациях">
          <div class="drug-schema__section-head">
            <AppGlyph name="book-open" class="drug-schema__section-icon" />
            <h3 class="drug-schema__section-title">
              В клинических рекомендациях ({krLinks().length})
            </h3>
          </div>
          <ul class="drug-schema__kr-list">
            <For each={krLinks()}>
              {(link) => (
                <li class="drug-schema__kr-item">
                  <button
                    type="button"
                    class="drug-schema__kr-btn"
                    onClick={() => props.onOpenRecommendation?.(link)}
                  >
                    <span class="drug-schema__kr-top">
                      <span class="drug-schema__kr-title">{link.recommendationTitle}</span>
                      <AppGlyph name="arrow-square-out" class="drug-schema__kr-open" />
                    </span>
                    <Show when={link.ageGroups.length > 0}>
                      <span class="drug-schema__kr-meta">{link.ageGroups.join(' · ')}</span>
                    </Show>
                    <Show when={link.evidenceQuote}>
                      <span class="drug-schema__kr-quote">{link.evidenceQuote}</span>
                    </Show>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <section class="drug-schema__protocols" aria-label="Блок-схема применения">
        <div class="drug-schema__section-head">
          <AppGlyph name="graph" class="drug-schema__section-icon" />
          <h3 class="drug-schema__section-title">Схема применения по группам пациентов</h3>
        </div>

        <Show when={availableGroups().length > 0}>
          <fieldset class="drug-schema__filters" aria-label="Группа пациентов">
            <For each={availableGroups()}>
              {(group) => (
                <button
                  type="button"
                  class="drug-schema__filter"
                  classList={{ 'drug-schema__filter--active': activeGroup() === group }}
                  aria-pressed={activeGroup() === group}
                  onClick={() => setActiveGroup(group)}
                >
                  {REGIMEN_PATIENT_GROUP_LABELS[group]}
                </button>
              )}
            </For>
          </fieldset>
        </Show>

        <ul class="drug-schema__branches">
          <For each={visibleBranches()}>
            {(branch) => (
              <li class={`drug-schema__branch drug-schema__branch--${branch.group}`}>
                <div class="drug-schema__branch-head">
                  <strong class="drug-schema__branch-title">{branch.scenario}</strong>
                  <div class="drug-schema__branch-badges">
                    <span class={`drug-schema__pill drug-schema__pill--${branch.group}`}>
                      {branch.patientBadge}
                    </span>
                    <span class="drug-schema__pill drug-schema__pill--route">{branch.route}</span>
                  </div>
                </div>

                <ol class="drug-schema__flow">
                  <For each={branch.steps}>
                    {(step, index) => (
                      <li class="drug-schema__flow-item">
                        <Show when={index() > 0}>
                          <span class="drug-schema__connector" aria-hidden="true">
                            <span class="drug-schema__connector-line" />
                            <AppGlyph name="arrow-right" class="drug-schema__connector-arrow" />
                          </span>
                        </Show>
                        <div class="drug-schema__node">
                          <div class="drug-schema__node-head">
                            <span class="drug-schema__node-stage">{step.stage}</span>
                            <Show when={step.duration}>
                              {(dur) => <span class="drug-schema__node-duration">{dur()}</span>}
                            </Show>
                          </div>
                          <strong class="drug-schema__node-dose">{step.dose}</strong>
                          <Show when={step.note}>
                            {(note) => <p class="drug-schema__node-note">{note()}</p>}
                          </Show>
                        </div>
                      </li>
                    )}
                  </For>
                </ol>

                <div class="drug-schema__branch-foot">
                  <Show when={branch.maxDaily}>
                    {(maxDaily) => (
                      <span class="drug-schema__foot-chip">Макс. сут.: {maxDaily()}</span>
                    )}
                  </Show>
                  <Show when={branch.courseLength}>
                    {(course) => <span class="drug-schema__foot-chip">Курс: {course()}</span>}
                  </Show>
                  <span class="drug-schema__foot-source">{branch.sourceLabel}</span>
                </div>
              </li>
            )}
          </For>
        </ul>
      </section>
    </div>
  );
}
