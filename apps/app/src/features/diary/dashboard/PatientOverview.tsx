import { For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { SkeletonLines } from '@/components/SkeletonLines';
import type { OverviewSignal, SignalTarget } from '@/features/diary/dashboard/patient-overview';

/**
 * The top of the doctor's patient page (DIARY20): a big «Статистика» button that opens the charts
 * page, and under it, in the same card, the week in brief — the worrying first, each row one tap
 * from its chart. Renders `overviewSignals` as they come; it never branches on a signal.
 */
export function PatientOverview(props: {
  /** Undefined while the questionnaires are still being scored: one loading state. */
  readonly signals: readonly OverviewSignal[] | undefined;
  readonly onOpen: (target: SignalTarget) => void;
  readonly onAll: () => void;
}): JSX.Element {
  return (
    <section class="diary-overview" aria-label="Статистика" data-testid="diary-overview">
      <button type="button" class="diary-overview__stats" onClick={() => props.onAll()}>
        <span class="diary-overview__stats-icon" aria-hidden="true">
          <AppGlyph name="chart-line" class="diary-overview__glyph" />
        </span>
        <span class="diary-overview__text">
          <span class="diary-overview__stats-title">Статистика</span>
          <span class="diary-overview__stats-note">все графики · кратко за неделю ниже</span>
        </span>
        <AppGlyph name="caret-right" class="diary-overview__chevron" />
      </button>
      <Show
        when={props.signals}
        fallback={<SkeletonLines lines={4} label="Считаем неделю пациента" />}
      >
        {(signals) => (
          <ul class="diary-overview__list">
            <For each={signals()}>
              {(signal) => (
                <li class="diary-overview__item">
                  <button
                    type="button"
                    class={`diary-overview__row diary-overview__row--${signal.tone}`}
                    data-signal={signal.id}
                    onClick={() => props.onOpen(signal.target)}
                  >
                    <span class="diary-overview__icon" aria-hidden="true">
                      <AppGlyph name={signal.glyph} class="diary-overview__glyph" />
                    </span>
                    <span class="diary-overview__text">
                      <span class="diary-overview__title">{signal.title}</span>
                      <Show when={signal.value || signal.trend}>
                        <span class="diary-overview__value">
                          {signal.value}
                          <Show when={signal.trend}>
                            {(trend) => (
                              <span class="diary-overview__trend">
                                <span aria-hidden="true">
                                  {trend().direction === 'up' ? '↑' : '↓'} {trend().text}
                                </span>
                                <span class="visually-hidden">
                                  {trend().direction === 'up' ? 'выше' : 'ниже'} на {trend().text}{' '}
                                  за неделю
                                </span>
                              </span>
                            )}
                          </Show>
                        </span>
                      </Show>
                      <Show when={signal.detail}>
                        <span class="diary-overview__detail">{signal.detail}</span>
                      </Show>
                    </span>
                    <AppGlyph name="caret-right" class="diary-overview__chevron" />
                  </button>
                </li>
              )}
            </For>
          </ul>
        )}
      </Show>
    </section>
  );
}
