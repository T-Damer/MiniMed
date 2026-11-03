import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { SkeletonLines } from '@/components/SkeletonLines';
import {
  type OverviewSignal,
  overviewSummary,
  type SignalTarget,
} from '@/features/diary/dashboard/patient-overview';

const OPEN_KEY = 'minimed.diary.overview-open.v1';

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function keepOpen(open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // A browser that keeps nothing: the card opens folded next time.
  }
}

/**
 * The top of the doctor's patient page (DIARY21, owner 2026-11-03: «everything within one screen»):
 * one folded «Статистика» row — the week's verdict in a line, a chevron that unfolds the brief rows
 * in place, an expand button that opens every chart full screen. The worrying rows come first, each
 * one tap from its chart. Renders `overviewSignals` as they come; it never branches on a signal.
 */
export function PatientOverview(props: {
  /** Undefined while the questionnaires are still being scored: one loading state. */
  readonly signals: readonly OverviewSignal[] | undefined;
  readonly onOpen: (target: SignalTarget) => void;
  readonly onAll: () => void;
}): JSX.Element {
  const [open, setOpen] = createSignal(readOpen());
  const toggle = (): void => {
    const next = !open();
    setOpen(next);
    keepOpen(next);
  };
  return (
    <section
      class="diary-overview"
      classList={{ 'diary-overview--open': open() }}
      aria-label="Статистика"
      data-testid="diary-overview"
    >
      <div class="diary-overview__head">
        <button
          type="button"
          class="diary-overview__stats"
          aria-expanded={open()}
          aria-controls="diary-overview-rows"
          onClick={toggle}
        >
          <span class="diary-overview__stats-icon" aria-hidden="true">
            <AppGlyph name="chart-line" class="diary-overview__glyph" />
          </span>
          <span class="diary-overview__text">
            <span class="diary-overview__stats-title">Статистика</span>
            <span class="diary-overview__stats-note">
              <Show when={props.signals} fallback="считаем неделю…">
                {(signals) => overviewSummary(signals())}
              </Show>
            </span>
          </span>
          <AppGlyph name="caret-down" class="diary-overview__fold" />
        </button>
        <Button
          variant="icon"
          class="diary-overview__full"
          aria-label="Все графики на весь экран"
          icon={<AppGlyph name="arrows-out-simple" class="diary-dash__glyph" />}
          onClick={() => props.onAll()}
        />
      </div>
      <div id="diary-overview-rows" class="diary-overview__body" inert={!open()}>
        <div class="diary-overview__body-inner">
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
                                      {trend().direction === 'up' ? 'выше' : 'ниже'} на{' '}
                                      {trend().text} за неделю
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
        </div>
      </div>
    </section>
  );
}
