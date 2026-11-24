import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import {
  AFFINITY_TIER_LABELS,
  BBB_LEVEL_LABELS,
  BBB_SHORT_LABELS,
  type DrugPharmacologyProfile,
  type DrugReceptorBinding,
  type ReceptorFamily,
  receptorFamilyOf,
  receptorPetalScale,
} from '@/features/medications/pharmacology/drug-pharmacology-schema';
import { lookupReceptorInfo } from '@/features/medications/pharmacology/receptor-encyclopedia';

/**
 * Interactive radial SVG Receptor Flower (inspired by `drug-receptor-map.html`):
 * each receptor binding is rendered as a scaled petal around a central disc with a rotary rim
 * indicator; tapping or focusing any petal displays its Ki, pharmacological action, CNS pathway
 * and clinical effect below. Uses pure theme-aware CSS classes and zero endless animations (PERF6).
 */

const CX = 300;
const CY = 260;
const HUB_RADIUS = 82;
const DIAL_RADIUS = 72;
const GUIDE_RADII = [128, 174, 218] as const;
const PETAL_PATH = 'M0 -18 Q44 -40 144 -44 Q160 -45 160 -28 V28 Q160 45 144 44 Q44 40 0 18Z';

interface FlowerRay {
  readonly id: string;
  readonly label: string;
  readonly subLabel: string;
  readonly family: ReceptorFamily | 'kinetics' | 'bbb' | 'dose';
  readonly scale: number;
  readonly angleDeg: number;
  readonly binding?: DrugReceptorBinding;
  readonly detailTitle: string;
  readonly detailAction: string;
  readonly detailBody: string;
  readonly detailPathway?: string;
}

function shortHalfLifeLabel(halfLife: string): string {
  const match = halfLife.match(/~?\d+(?:[.,–-]\d+)?\s*(?:ч|сут|дн)/iu);
  return match ? match[0] : halfLife.slice(0, 10);
}

function buildFlowerRays(profile: DrugPharmacologyProfile): readonly FlowerRay[] {
  const items: Omit<FlowerRay, 'angleDeg'>[] = profile.receptors.map((binding, index) => ({
    id: `rec-${index}`,
    label: binding.receptor.split(' ')[0] ?? binding.receptor,
    subLabel: binding.kiNm
      ? binding.kiNm.replace(/\s*\([^)]*\)/gu, '').trim()
      : AFFINITY_TIER_LABELS[binding.affinity],
    family: receptorFamilyOf(binding.receptor),
    scale: receptorPetalScale(binding),
    binding,
    detailTitle: binding.receptor,
    detailAction: `${binding.action}${binding.kiNm ? ` · Ki ${binding.kiNm}` : ''}`,
    detailBody: binding.clinicalEffect,
    detailPathway: binding.pathway,
  }));

  items.push({
    id: 'pk-halflife',
    label: 't½',
    subLabel: shortHalfLifeLabel(profile.pk.halfLife),
    family: 'kinetics',
    scale: 0.74,
    detailTitle: 'Период полувыведения (t½)',
    detailAction: profile.pk.halfLife,
    detailBody: [
      profile.pk.tmax ? `Tmax: ${profile.pk.tmax}` : '',
      profile.pk.metabolism ? `Метаболизм: ${profile.pk.metabolism}` : '',
      profile.pk.steadyState ? `Равновесие: ${profile.pk.steadyState}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  });

  if (profile.pk.bbb) {
    const bbb = profile.pk.bbb;
    const bbbScale =
      bbb.level === 'high'
        ? 0.86
        : bbb.level === 'moderate'
          ? 0.76
          : bbb.level === 'low'
            ? 0.68
            : 0.62;
    items.push({
      id: 'pk-bbb',
      label: 'ГЭБ',
      subLabel: BBB_SHORT_LABELS[bbb.level],
      family: 'bbb',
      scale: bbbScale,
      detailTitle: 'Проникновение через ГЭБ',
      detailAction: `${BBB_LEVEL_LABELS[bbb.level]}${bbb.pGpSubstrate ? ' · субстрат P-gp' : ''}`,
      detailBody: bbb.summary,
    });
  }

  if (profile.pk.typicalDose) {
    items.push({
      id: 'pk-dose',
      label: 'Доза',
      subLabel: profile.pk.typicalDose.split('(')[0]?.trim().slice(0, 14) ?? profile.pk.typicalDose,
      family: 'dose',
      scale: 0.72,
      detailTitle: 'Типичный диапазон доз',
      detailAction: profile.pk.typicalDose,
      detailBody:
        'Ориентировочный суточный диапазон для взрослых; сверяйтесь с разделом «Способ применения и дозы» в инструкции.',
    });
  }

  const count = items.length;
  const startAngle = -90;
  return items.map((item, index) => ({
    ...item,
    angleDeg: startAngle + (index * 360) / count,
  }));
}

export function DrugReceptorFlower(props: {
  readonly drugName: string;
  readonly profile: DrugPharmacologyProfile;
}): JSX.Element {
  const rays = createMemo(() => buildFlowerRays(props.profile));
  const [selectedId, setSelectedId] = createSignal<string | null>(null);

  const activeRay = createMemo(() => {
    const id = selectedId();
    const list = rays();
    return (id ? list.find((ray) => ray.id === id) : undefined) ?? list[0];
  });

  const dialRotation = (): number => activeRay()?.angleDeg ?? -90;

  return (
    <div class="drug-flower">
      <svg
        class="drug-flower__svg"
        viewBox="0 0 600 520"
        role="img"
        aria-label={`Цветок рецепторного профиля: ${props.drugName}`}
      >
        <g class="drug-flower__guides">
          <For each={GUIDE_RADII}>
            {(radius) => <circle class="drug-flower__guide" cx={CX} cy={CY} r={radius} />}
          </For>
        </g>

        <g class="drug-flower__petals">
          <For each={rays()}>
            {(ray) => {
              const isSelected = () => activeRay()?.id === ray.id;
              const rad = (ray.angleDeg * Math.PI) / 180;
              const tipDist = HUB_RADIUS + 148 * ray.scale;
              const labelDist = HUB_RADIUS + Math.max(58, 108 * ray.scale);
              const lx = CX + Math.cos(rad) * labelDist;
              const ly = CY + Math.sin(rad) * labelDist;
              const petalTransform = `translate(${CX} ${CY}) rotate(${ray.angleDeg}) translate(${HUB_RADIUS - 14} 0) scale(${ray.scale})`;
              const dotX = CX + Math.cos(rad) * (tipDist - 16);
              const dotY = CY + Math.sin(rad) * (tipDist - 16);
              return (
                // biome-ignore lint/a11y/useSemanticElements: SVG petal inside <svg> cannot be an HTML <button>.
                <g
                  class={`drug-flower__petal drug-flower__petal--${ray.family}`}
                  classList={{ 'drug-flower__petal--active': isSelected() }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${ray.detailTitle}: ${ray.detailAction}`}
                  aria-pressed={isSelected()}
                  onClick={() => setSelectedId(ray.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedId(ray.id);
                    }
                  }}
                >
                  <path
                    class="drug-flower__petal-shape"
                    d={PETAL_PATH}
                    transform={petalTransform}
                  />
                  <circle
                    class="drug-flower__petal-dot"
                    cx={dotX}
                    cy={dotY}
                    r={isSelected() ? 4.5 : 3}
                  />
                  <text class="drug-flower__petal-label" x={lx} y={ly - 5} text-anchor="middle">
                    {ray.label}
                  </text>
                  <text class="drug-flower__petal-sub" x={lx} y={ly + 11} text-anchor="middle">
                    {ray.subLabel.length > 14 ? `${ray.subLabel.slice(0, 13)}…` : ray.subLabel}
                  </text>
                </g>
              );
            }}
          </For>
        </g>

        <g class="drug-flower__hub">
          <circle class="drug-flower__hub-disc" cx={CX} cy={CY} r={HUB_RADIUS} />
          <circle
            class="drug-flower__dial"
            cx={CX}
            cy={CY}
            r={DIAL_RADIUS}
            transform={`rotate(${dialRotation()} ${CX} ${CY})`}
          />
          <text class="drug-flower__hub-name" x={CX} y={CY - 8} text-anchor="middle">
            {props.drugName.length > 15 ? `${props.drugName.slice(0, 14)}…` : props.drugName}
          </text>
          <text class="drug-flower__hub-selected" x={CX} y={CY + 14} text-anchor="middle">
            {activeRay()?.label ?? ''}
          </text>
          <text class="drug-flower__hub-count" x={CX} y={CY + 34} text-anchor="middle">
            {props.profile.receptors.length} мишеней
          </text>
        </g>
      </svg>

      <Show when={activeRay()}>
        {(ray) => {
          const receptorInfo = createMemo(() =>
            ray().binding ? lookupReceptorInfo(ray().binding?.receptor ?? '') : null,
          );
          return (
            <div class={`drug-flower__inspector drug-flower__inspector--${ray().family}`}>
              <div class="drug-flower__inspector-head">
                <strong class="drug-flower__inspector-title">{ray().detailTitle}</strong>
                <Show when={ray().binding}>
                  {(binding) => (
                    <span class="drug-flower__inspector-tier">
                      {AFFINITY_TIER_LABELS[binding().affinity]}
                    </span>
                  )}
                </Show>
              </div>
              <p class="drug-flower__inspector-action">{ray().detailAction}</p>
              <Show when={ray().detailPathway}>
                {(pathway) => (
                  <p class="drug-flower__inspector-pathway">
                    <span class="drug-flower__inspector-label">Путь / зона: </span>
                    {pathway()}
                  </p>
                )}
              </Show>
              <Show when={ray().detailBody}>
                <p class="drug-flower__inspector-body">{ray().detailBody}</p>
              </Show>
              <Show when={receptorInfo()}>
                {(info) => (
                  <div class="drug-receptor-ref" data-testid="receptor-reference-info">
                    <div class="drug-receptor-ref__head">
                      <strong class="drug-receptor-ref__name">{info().fullName}</strong>
                      <span class="drug-receptor-ref__mech">{info().mechanism}</span>
                    </div>
                    <ul class="drug-receptor-ref__zones">
                      <For each={info().zones}>
                        {(entry) => (
                          <li class="drug-receptor-ref__zone">
                            <span class="drug-receptor-ref__zone-name">{entry.zone}: </span>
                            <span class="drug-receptor-ref__zone-role">{entry.role}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                    <p class="drug-receptor-ref__effect">
                      <span class="drug-receptor-ref__label">Блокада: </span>
                      {info().antagonismEffects}
                    </p>
                    <p class="drug-receptor-ref__effect">
                      <span class="drug-receptor-ref__label">Активация: </span>
                      {info().agonismEffects}
                    </p>
                  </div>
                )}
              </Show>
            </div>
          );
        }}
      </Show>
    </div>
  );
}
