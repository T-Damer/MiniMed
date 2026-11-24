import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import type { ClinicalMedicationLink } from '@/features/medications/clinical-medication-links';
import { DrugReceptorFlower } from '@/features/medications/pharmacology/DrugReceptorFlower';
import { DrugUsageSchemaView } from '@/features/medications/pharmacology/DrugUsageSchemaView';
import {
  AFFINITY_TIER_LABELS,
  BBB_LEVEL_LABELS,
  CLINICAL_EFFECT_LEVEL_DESCRIPTION,
  CLINICAL_EFFECT_LEVEL_TEXT,
  CLINICAL_EFFECT_META,
  type ClinicalEffectKind,
  type ClinicalEffectLevel,
  type DrugClinicalEffectMetric,
  type DrugPharmacologyProfile,
  effectiveRegimenBranches,
  type ReceptorAffinityTier,
  sedationActivationBalance,
  splitEffectsByCategory,
} from '@/features/medications/pharmacology/drug-pharmacology-schema';
import { lookupDrugPharmacology } from '@/features/medications/pharmacology/psychotropic-pharmacology';
import { lookupReceptorInfo } from '@/features/medications/pharmacology/receptor-encyclopedia';

import '@/features/medications/pharmacology/drug-pinned-facts.css';

type ModalTab = 'flower' | 'schema' | 'effects' | 'pk';

function shortHalfLifeBadge(halfLife: string): string {
  const match = halfLife.match(/~?\d+(?:[.,–-]\d+)?\s*(?:ч|сут|дн)/iu);
  if (match) return match[0].replace(/\s+/gu, ' ');
  const first = halfLife.split('(')[0]?.trim() ?? halfLife;
  return first.length > 9 ? `${first.slice(0, 8)}…` : first;
}

function affinityModifier(tier: ReceptorAffinityTier): string {
  return `drug-facts-receptor--${tier}`;
}

function effectTone(
  metric: DrugClinicalEffectMetric,
): 'none' | 'therapeutic' | 'neutral' | 'caution' | 'danger' {
  if (metric.level === 0) return 'none';
  const meta = CLINICAL_EFFECT_META[metric.kind];
  if (meta.polarity === 'therapeutic') return 'therapeutic';
  if (meta.polarity === 'neutral') return metric.level >= 3 ? 'caution' : 'neutral';
  return metric.level >= 3 ? 'danger' : metric.level === 2 ? 'caution' : 'neutral';
}

/** Picks up to 4 highest-signal clinical effect icons for the second row (keeping sedation/activation first). */
function rowEffectPicks(profile: DrugPharmacologyProfile): readonly DrugClinicalEffectMetric[] {
  const priorityOrder: readonly ClinicalEffectKind[] = [
    'sedation',
    'activation',
    'antidepressant',
    'anxiolytic',
    'eps',
    'weight',
    'prolactin',
    'anticholinergic',
    'orthostasis',
    'qtc',
  ];
  const byKind = new Map(profile.effects.map((item) => [item.kind, item]));
  const picked: DrugClinicalEffectMetric[] = [];
  for (const kind of ['sedation', 'activation'] as const) {
    const found = byKind.get(kind);
    if (found) picked.push(found);
  }
  const rest = priorityOrder
    .filter((kind) => kind !== 'sedation' && kind !== 'activation')
    .flatMap((kind) => {
      const item = byKind.get(kind);
      return item ? [item] : [];
    })
    .sort((left, right) => right.level - left.level);
  for (const item of rest) {
    if (picked.length >= 4) break;
    picked.push(item);
  }
  return picked;
}

function MeterCells(props: {
  readonly level: ClinicalEffectLevel;
  readonly tone: string;
}): JSX.Element {
  return (
    <span class={`drug-effects__meter drug-effects__meter--${props.tone}`} aria-hidden="true">
      <For each={[1, 2, 3] as const}>
        {(step) => (
          <span
            class="drug-effects__meter-cell"
            classList={{ 'drug-effects__meter-cell--filled': props.level >= step }}
          />
        )}
      </For>
    </span>
  );
}

/**
 * Second row of circular pharmacology icons on psychiatric drug cards (receptor flower, t½, and
 * key clinical effects such as sedation, activation, mood, EPS, weight), opening the interactive
 * Receptor Flower + Clinical Effects + Pharmacokinetics sheet on tap. Schema-first (AGENTS.md).
 */
export function DrugPinnedFacts(props: {
  readonly inn?: string | null | undefined;
  readonly fallbackTitle?: string | null | undefined;
  readonly candidates?: readonly (string | null | undefined)[];
  readonly clinicalMedicationLinks?: readonly ClinicalMedicationLink[] | undefined;
  readonly onOpenRecommendation?: ((link: ClinicalMedicationLink) => void) | undefined;
  readonly onCompare?: (() => void) | undefined;
  readonly onInteractions?: (() => void) | undefined;
}): JSX.Element {
  const profile = createMemo(() => {
    const ordered = [props.inn, ...(props.candidates ?? []), props.fallbackTitle];
    for (const candidate of ordered) {
      const match = lookupDrugPharmacology(candidate);
      if (match) return match;
    }
    return null;
  });

  const displayName = createMemo(() => {
    const candidate = props.fallbackTitle?.trim() || props.inn?.trim();
    if (candidate) return candidate;
    const inn = profile()?.inns[0] ?? 'Препарат';
    return inn.charAt(0).toLocaleUpperCase('ru-RU') + inn.slice(1);
  });

  const [openTab, setOpenTab] = createSignal<ModalTab | null>(null);
  const [focusedEffect, setFocusedEffect] = createSignal<ClinicalEffectKind | null>(null);
  const [listExpanded, setListExpanded] = createSignal(false);
  const [expandedReceptor, setExpandedReceptor] = createSignal<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = createSignal(false);

  const openModal = (tab: ModalTab, effect: ClinicalEffectKind | null = null): void => {
    setFocusedEffect(effect);
    setOpenTab(tab);
  };

  return (
    <Show when={profile()}>
      {(facts) => (
        <>
          <ul
            class="drug-psych-row"
            aria-label="Психофармакологический профиль"
            data-testid="drug-pinned-facts"
          >
            <li class="drug-psych-row__cell">
              <button
                type="button"
                class="drug-psych-row__item"
                data-testid="drug-fact-receptors"
                aria-label={`Рецепторный цветок (${facts().receptors.length} мишеней)`}
                title={`Рецепторный профиль (${facts().receptors.length} мишеней)`}
                onClick={() => openModal('flower')}
              >
                <span class="drug-psych-row__badge drug-psych-row__badge--flower">
                  <AppGlyph name="flower" class="drug-psych-row__glyph" />
                  <span class="drug-psych-row__value">{facts().receptors.length}</span>
                </span>
                <span class="drug-psych-row__label">Рецепторы</span>
              </button>
            </li>
            <li class="drug-psych-row__cell">
              <button
                type="button"
                class="drug-psych-row__item"
                data-testid="drug-fact-schema"
                aria-label={`Схема применения и КР (${effectiveRegimenBranches(facts()).length})`}
                title={`Схема применения (${effectiveRegimenBranches(facts()).length})`}
                onClick={() => openModal('schema')}
              >
                <span class="drug-psych-row__badge drug-psych-row__badge--schema">
                  <AppGlyph name="graph" class="drug-psych-row__glyph" />
                  <span class="drug-psych-row__value">
                    {(props.clinicalMedicationLinks?.length ?? 0) > 0
                      ? 'КР'
                      : effectiveRegimenBranches(facts()).length}
                  </span>
                </span>
                <span class="drug-psych-row__label">Схема</span>
              </button>
            </li>
            <li class="drug-psych-row__cell">
              <button
                type="button"
                class="drug-psych-row__item"
                data-testid="drug-fact-pk"
                aria-label={`Период полувыведения: ${facts().pk.halfLife}`}
                title={`t½: ${facts().pk.halfLife}`}
                onClick={() => openModal('pk')}
              >
                <span class="drug-psych-row__badge drug-psych-row__badge--pk">
                  <AppGlyph name="clock" class="drug-psych-row__glyph" />
                  <span class="drug-psych-row__value">
                    {shortHalfLifeBadge(facts().pk.halfLife)}
                  </span>
                </span>
                <span class="drug-psych-row__label">t½</span>
              </button>
            </li>
            <For each={rowEffectPicks(facts())}>
              {(metric) => {
                const meta = CLINICAL_EFFECT_META[metric.kind];
                const tone = effectTone(metric);
                return (
                  <li class="drug-psych-row__cell">
                    <button
                      type="button"
                      class="drug-psych-row__item"
                      data-effect={metric.kind}
                      aria-label={`${meta.label}: ${CLINICAL_EFFECT_LEVEL_DESCRIPTION[metric.level]}`}
                      title={`${meta.label}: ${CLINICAL_EFFECT_LEVEL_DESCRIPTION[metric.level]}`}
                      onClick={() => openModal('effects', metric.kind)}
                    >
                      <span class={`drug-psych-row__badge drug-psych-row__badge--${tone}`}>
                        <AppGlyph name={meta.glyph} class="drug-psych-row__glyph" />
                        <span class="drug-psych-row__value">
                          {CLINICAL_EFFECT_LEVEL_TEXT[metric.level]}
                        </span>
                      </span>
                      <span class="drug-psych-row__label">{meta.shortLabel}</span>
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>

          <OverlayDialog
            open={openTab() !== null}
            title={
              openTab() === 'schema'
                ? `Схема применения: ${displayName()}`
                : openTab() === 'pk'
                  ? 'Фармакокинетика'
                  : openTab() === 'effects'
                    ? 'Эффекты и побочные реакции'
                    : `Рецепторы: ${displayName()}`
            }
            class="drug-facts-dialog"
            onClose={() => setOpenTab(null)}
          >
            <div class="drug-facts-modal">
              <p class="drug-facts-modal__class">{facts().classLabel}</p>
              <div class="drug-facts-modal__tabs" role="tablist" aria-label="Раздел параметров">
                <button
                  type="button"
                  role="tab"
                  aria-selected={openTab() === 'flower'}
                  class="drug-facts-modal__tab"
                  classList={{ 'drug-facts-modal__tab--active': openTab() === 'flower' }}
                  onClick={() => setOpenTab('flower')}
                >
                  <AppGlyph name="flower" class="drug-facts-modal__tab-icon" />
                  Влияние
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={openTab() === 'schema'}
                  class="drug-facts-modal__tab"
                  classList={{ 'drug-facts-modal__tab--active': openTab() === 'schema' }}
                  onClick={() => setOpenTab('schema')}
                >
                  <AppGlyph name="graph" class="drug-facts-modal__tab-icon" />
                  Схема
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={openTab() === 'effects'}
                  class="drug-facts-modal__tab"
                  classList={{ 'drug-facts-modal__tab--active': openTab() === 'effects' }}
                  onClick={() => setOpenTab('effects')}
                >
                  <AppGlyph name="lightning" class="drug-facts-modal__tab-icon" />
                  Эффекты
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
                  Кинетика
                </button>
              </div>

              <Show when={openTab() === 'schema'}>
                <DrugUsageSchemaView
                  profile={facts()}
                  clinicalLinks={props.clinicalMedicationLinks}
                  onOpenRecommendation={(link) => {
                    setOpenTab(null);
                    props.onOpenRecommendation?.(link);
                  }}
                />
              </Show>

              <Show when={openTab() === 'flower'}>
                <DrugReceptorFlower drugName={displayName()} profile={facts()} />
                <div class="drug-facts-list-toggle">
                  <button
                    type="button"
                    class="drug-facts-sources__toggle"
                    aria-expanded={listExpanded()}
                    onClick={() => setListExpanded((value) => !value)}
                  >
                    <span class="drug-facts-sources__toggle-label">
                      Все рецепторы списком ({facts().receptors.length})
                    </span>
                    <AppGlyph
                      name={listExpanded() ? 'caret-up' : 'caret-down'}
                      class="drug-facts-sources__toggle-icon"
                    />
                  </button>
                  <Show when={listExpanded()}>
                    <ul class="drug-facts-receptors">
                      <For each={facts().receptors}>
                        {(binding) => {
                          const info = lookupReceptorInfo(binding.receptor);
                          const isOpen = () => expandedReceptor() === binding.receptor;
                          return (
                            <li class={`drug-facts-receptor ${affinityModifier(binding.affinity)}`}>
                              <button
                                type="button"
                                class="drug-facts-receptor__trigger"
                                aria-expanded={info ? isOpen() : undefined}
                                onClick={() => {
                                  if (!info) return;
                                  setExpandedReceptor((prev) =>
                                    prev === binding.receptor ? null : binding.receptor,
                                  );
                                }}
                              >
                                <div class="drug-facts-receptor__top">
                                  <strong class="drug-facts-receptor__name">
                                    {binding.receptor}
                                  </strong>
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
                                <Show when={info}>
                                  <span class="drug-facts-receptor__more">
                                    {isOpen()
                                      ? 'Скрыть справку о рецепторе'
                                      : 'О рецепторе и зонах'}
                                    <AppGlyph
                                      name={isOpen() ? 'caret-up' : 'caret-down'}
                                      class="drug-facts-receptor__more-icon"
                                    />
                                  </span>
                                </Show>
                              </button>
                              <Show when={info && isOpen()}>
                                <div class="drug-receptor-ref drug-receptor-ref--in-list">
                                  <div class="drug-receptor-ref__head">
                                    <strong class="drug-receptor-ref__name">
                                      {info?.fullName}
                                    </strong>
                                    <span class="drug-receptor-ref__mech">{info?.mechanism}</span>
                                  </div>
                                  <ul class="drug-receptor-ref__zones">
                                    <For each={info?.zones ?? []}>
                                      {(entry) => (
                                        <li class="drug-receptor-ref__zone">
                                          <span class="drug-receptor-ref__zone-name">
                                            {entry.zone}:{' '}
                                          </span>
                                          <span class="drug-receptor-ref__zone-role">
                                            {entry.role}
                                          </span>
                                        </li>
                                      )}
                                    </For>
                                  </ul>
                                  <p class="drug-receptor-ref__effect">
                                    <span class="drug-receptor-ref__label">Блокада: </span>
                                    {info?.antagonismEffects}
                                  </p>
                                  <p class="drug-receptor-ref__effect">
                                    <span class="drug-receptor-ref__label">Активация: </span>
                                    {info?.agonismEffects}
                                  </p>
                                </div>
                              </Show>
                            </li>
                          );
                        }}
                      </For>
                    </ul>
                  </Show>
                </div>
              </Show>

              <Show when={openTab() === 'effects'}>
                {(() => {
                  const balance = sedationActivationBalance(facts().effects);
                  const { therapeutic, adverse } = splitEffectsByCategory(facts().effects);
                  const renderEffectCard = (metric: DrugClinicalEffectMetric): JSX.Element => {
                    const meta = CLINICAL_EFFECT_META[metric.kind];
                    const tone = effectTone(metric);
                    return (
                      <li
                        class={`drug-effects__card drug-effects__card--${tone}`}
                        classList={{
                          'drug-effects__card--focused': focusedEffect() === metric.kind,
                        }}
                      >
                        <div class="drug-effects__head">
                          <span class={`drug-effects__icon drug-effects__icon--${tone}`}>
                            <AppGlyph name={meta.glyph} class="drug-effects__glyph" />
                          </span>
                          <div class="drug-effects__meta">
                            <strong class="drug-effects__title">{meta.label}</strong>
                            <span class="drug-effects__level">
                              {CLINICAL_EFFECT_LEVEL_DESCRIPTION[metric.level]} (
                              {CLINICAL_EFFECT_LEVEL_TEXT[metric.level]})
                            </span>
                          </div>
                          <MeterCells level={metric.level} tone={tone} />
                        </div>
                        <p class="drug-effects__note">{metric.note}</p>
                      </li>
                    );
                  };
                  return (
                    <div class="drug-effects-view">
                      <section class="drug-balance" aria-label="Баланс седация и активация">
                        <div class="drug-balance__head">
                          <span class="drug-balance__pole">
                            <AppGlyph name="moon" class="drug-balance__icon" />
                            Седация {CLINICAL_EFFECT_LEVEL_TEXT[balance.sedation]}
                          </span>
                          <strong class="drug-balance__summary">{balance.label}</strong>
                          <span class="drug-balance__pole">
                            Активация {CLINICAL_EFFECT_LEVEL_TEXT[balance.activation]}
                            <AppGlyph name="lightning" class="drug-balance__icon" />
                          </span>
                        </div>
                        <div class="drug-balance__track" aria-hidden="true">
                          <div class="drug-balance__half drug-balance__half--sedation">
                            <For each={[3, 2, 1] as const}>
                              {(step) => (
                                <span
                                  class="drug-balance__cell drug-balance__cell--sedation"
                                  classList={{
                                    'drug-balance__cell--filled': balance.sedation >= step,
                                  }}
                                />
                              )}
                            </For>
                          </div>
                          <span class="drug-balance__axis" />
                          <div class="drug-balance__half drug-balance__half--activation">
                            <For each={[1, 2, 3] as const}>
                              {(step) => (
                                <span
                                  class="drug-balance__cell drug-balance__cell--activation"
                                  classList={{
                                    'drug-balance__cell--filled': balance.activation >= step,
                                  }}
                                />
                              )}
                            </For>
                          </div>
                        </div>
                      </section>

                      <Show when={therapeutic.length > 0}>
                        <h3 class="drug-effects-view__heading">Профиль действия</h3>
                        <ul class="drug-effects">
                          <For each={therapeutic}>{renderEffectCard}</For>
                        </ul>
                      </Show>

                      <Show when={adverse.length > 0}>
                        <h3 class="drug-effects-view__heading">Побочные реакции и их сила</h3>
                        <ul class="drug-effects">
                          <For each={adverse}>{renderEffectCard}</For>
                        </ul>
                      </Show>
                    </div>
                  );
                })()}
              </Show>

              <Show when={openTab() === 'pk'}>
                <dl class="drug-facts-pk">
                  <div class="drug-facts-pk__row">
                    <dt class="drug-facts-pk__term">Период полувыведения (t½)</dt>
                    <dd class="drug-facts-pk__value">{facts().pk.halfLife}</dd>
                  </div>
                  <Show when={facts().pk.bbb}>
                    {(bbb) => (
                      <div class="drug-facts-pk__row" data-testid="drug-fact-bbb">
                        <dt class="drug-facts-pk__term">Проникновение через ГЭБ</dt>
                        <dd class="drug-facts-pk__value">
                          <span
                            class={`drug-facts-pk__bbb-badge drug-facts-pk__bbb-badge--${bbb().level}`}
                          >
                            {BBB_LEVEL_LABELS[bbb().level]}
                          </span>
                          <Show when={bbb().pGpSubstrate}>
                            <span class="drug-facts-pk__pgp-badge">Субстрат P-gp</span>
                          </Show>
                          <p class="drug-facts-pk__bbb-summary">{bbb().summary}</p>
                        </dd>
                      </div>
                    )}
                  </Show>
                  <Show when={facts().pk.typicalDose}>
                    {(dose) => (
                      <div class="drug-facts-pk__row">
                        <dt class="drug-facts-pk__term">Ориентировочные суточные дозы</dt>
                        <dd class="drug-facts-pk__value">{dose()}</dd>
                      </div>
                    )}
                  </Show>
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

              <Show when={props.onCompare || props.onInteractions}>
                <div class="drug-facts-actions">
                  <Show when={props.onCompare}>
                    {(onCompare) => (
                      <button
                        type="button"
                        class="drug-facts-actions__btn"
                        data-testid="drug-facts-compare"
                        onClick={() => {
                          setOpenTab(null);
                          onCompare()();
                        }}
                      >
                        <AppGlyph name="text-columns" class="drug-facts-actions__icon" />
                        Сравнить с другим
                      </button>
                    )}
                  </Show>
                  <Show when={props.onInteractions}>
                    {(onInteractions) => (
                      <button
                        type="button"
                        class="drug-facts-actions__btn"
                        data-testid="drug-facts-interactions"
                        onClick={() => {
                          setOpenTab(null);
                          onInteractions()();
                        }}
                      >
                        <AppGlyph name="arrows-down-up" class="drug-facts-actions__icon" />
                        Взаимодействия
                      </button>
                    )}
                  </Show>
                </div>
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
