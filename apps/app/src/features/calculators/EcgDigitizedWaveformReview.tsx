import { For, type JSX } from 'solid-js';

import type { EcgDigitizationResult } from '@/features/calculators/ecg-model-contract';
import {
  detectEcgLeadIntervals,
  detectEcgWaveMarkers,
  type EcgIntervalRange,
} from '@/features/calculators/ecg-waveform-measurements';

const WIDTH = 420;
const HEIGHT = 110;
const PADDING = 18;

const RANGE_BANDS = [
  { id: 'qrs', label: 'QRS', lane: 6 },
  { id: 'st', label: 'ST', lane: 22 },
  { id: 'qt', label: 'QT', lane: 38 },
] as const;

type RangeBand = (typeof RANGE_BANDS)[number];

type DisplayRange = RangeBand & {
  readonly durationMs: number;
  readonly range: EcgIntervalRange;
};

function chartGeometry(samples: Float32Array): {
  readonly amplitude: number;
  readonly points: string;
} {
  const finite = [...samples].filter(Number.isFinite);
  const amplitude = Math.max(0.25, ...finite.map((value) => Math.abs(value)));
  const points = [...samples]
    .map((value, index) => {
      if (!Number.isFinite(value)) return '';
      const x = PADDING + (index / Math.max(1, samples.length - 1)) * (WIDTH - PADDING * 2);
      const y = HEIGHT / 2 - ((value ?? 0) / amplitude) * (HEIGHT / 2 - PADDING);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(' ');
  return { amplitude, points };
}

export function EcgDigitizedWaveformReview(props: {
  readonly result: EcgDigitizationResult;
}): JSX.Element {
  return (
    <section class="ecg-wave-review" aria-labelledby="ecg-wave-review-title">
      <div class="ecg-wave-review__header">
        <h4 id="ecg-wave-review-title" class="ecg-wave-review__title">
          Извлечённые кривые и автоматические черновики
        </h4>
        <span class="ecg-wave-review__meta">100 Гц · мВ · Q/R/S/T · QRS/ST/QT</span>
      </div>
      <p class="ecg-wave-review__note">
        Точки и диапазоны рассчитаны автоматически по одному комплексу в каждом коротком отведении.
        Это черновики без клинической валидации: сверяйте их с исходной записью и не используйте без
        проверки источника.
      </p>
      <div class="ecg-wave-review__grid">
        <For each={props.result.leads.filter((lead) => lead.coverage >= 0.7)}>
          {(lead) => {
            const geometry = () => chartGeometry(lead.samples);
            const markers = () =>
              detectEcgWaveMarkers(lead, props.result.sampleRateHz, props.result.rrMs);
            const ranges = (): readonly DisplayRange[] => {
              const detected = detectEcgLeadIntervals(
                lead,
                props.result.sampleRateHz,
                props.result.rrMs,
              );
              if (!detected) return [];
              return RANGE_BANDS.flatMap((band) => {
                const range = detected.ranges[band.id];
                return range
                  ? [
                      {
                        ...band,
                        durationMs: Math.round(
                          ((range.end - range.start) / props.result.sampleRateHz) * 1_000,
                        ),
                        range,
                      },
                    ]
                  : [];
              });
            };
            const xAt = (index: number): number =>
              PADDING + (index / Math.max(1, lead.samples.length - 1)) * (WIDTH - PADDING * 2);
            return (
              <article class="ecg-wave-review__lead">
                <div class="ecg-wave-review__lead-header">
                  <strong class="ecg-wave-review__lead-name">{lead.name}</strong>
                  <span class="ecg-wave-review__coverage">{Math.round(lead.coverage * 100)}%</span>
                </div>
                <svg
                  class="ecg-wave-review__chart"
                  viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                  role="img"
                  aria-label={`Извлечённая кривая отведения ${lead.name}; автоматические диапазоны QRS, ST и QT требуют проверки источника`}
                >
                  <line
                    class="ecg-wave-review__baseline"
                    x1={PADDING}
                    y1={HEIGHT / 2}
                    x2={WIDTH - PADDING}
                    y2={HEIGHT / 2}
                  />
                  <For each={ranges()}>
                    {(displayRange) => (
                      <rect
                        class={`ecg-wave-review__range ecg-wave-review__range--${displayRange.id}`}
                        x={xAt(displayRange.range.start)}
                        y={displayRange.lane}
                        width={Math.max(
                          1,
                          xAt(displayRange.range.end) - xAt(displayRange.range.start),
                        )}
                        height="9"
                      >
                        <title>
                          Автоматический черновой диапазон {displayRange.label} в отведении{' '}
                          {lead.name}: {displayRange.durationMs} мс; требует проверки источника
                        </title>
                      </rect>
                    )}
                  </For>
                  <polyline class="ecg-wave-review__trace" points={geometry().points} />
                  <For each={markers()}>
                    {(marker) => {
                      const x =
                        PADDING +
                        (marker.index / Math.max(1, lead.samples.length - 1)) *
                          (WIDTH - PADDING * 2);
                      const y =
                        HEIGHT / 2 -
                        (marker.amplitudeMv / geometry().amplitude) * (HEIGHT / 2 - PADDING);
                      return (
                        <>
                          <circle class="ecg-wave-review__marker" cx={x} cy={y} r="4" />
                          <text class="ecg-wave-review__marker-label" x={x + 5} y={y - 5}>
                            {marker.wave}
                          </text>
                        </>
                      );
                    }}
                  </For>
                </svg>
                <ul
                  class="ecg-wave-review__ranges"
                  aria-label={`Автоматические диапазоны отведения ${lead.name}`}
                >
                  <For each={ranges()}>
                    {(displayRange) => (
                      <li
                        class={`ecg-wave-review__range-label ecg-wave-review__range-label--${displayRange.id}`}
                      >
                        {displayRange.label}: {displayRange.durationMs} мс
                      </li>
                    )}
                  </For>
                </ul>
              </article>
            );
          }}
        </For>
      </div>
    </section>
  );
}
