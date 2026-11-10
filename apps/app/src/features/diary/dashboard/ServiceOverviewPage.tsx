import type { DiaryAdminStats } from '@localmed/contracts';
import { createMemo, createResource, For, type JSX, Show } from 'solid-js';

import { PAGE_HEROES } from '@/app/page-heroes';
import { Button } from '@/components/Button';
import type { HeaderAction } from '@/components/HeaderActions';
import { HorizontalScroller } from '@/components/HorizontalScroller';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { StatCard, StatGrid } from '@/components/StatCard';
import { Heading } from '@/components/Text';
import { pluralize } from '@/diary/diary-format';
import { DiaryApiError, diaryAdmin } from '@/features/diary/connected/diary-api';
import { type DoctorSession, doctorApi } from '@/features/diary/connected/doctor-account';
import {
  lastActivityLabel,
  overviewTiles,
  weekBars,
} from '@/features/diary/dashboard/service-overview';

import '@/features/diary/dashboard/service-overview.css';

/** The address segment of «Обзор сервиса» (patient ids are 12–32 characters, so it cannot clash). */
export const SERVICE_OVERVIEW_ROUTE = 'service';

/** Every figure zero: what the tiles show, dimmed, while the service answers (no layout shift). */
const EMPTY_STATS: DiaryAdminStats = {
  generatedAt: '',
  doctors: { total: 0, withPatients: 0, new7: 0, new30: 0 },
  patients: {
    total: 0,
    withdrawn: 0,
    withPhone: 0,
    withCarer: 0,
    active7: 0,
    active30: 0,
    new7: 0,
    new30: 0,
  },
  phones: { patient: 0, carer: 0 },
  records: { total: 0, last7: 0, last30: 0 },
  alerts: { total: 0, open: 0 },
  weeks: [],
  doctorRows: [],
};

function failureText(cause: unknown): string {
  if (cause instanceof DiaryApiError && cause.status === 403) {
    return 'Этот раздел открыт только владельцу сервиса.';
  }
  if (cause instanceof DiaryApiError && cause.status === 0) {
    return 'Нет связи с сервером. Проверьте интернет и повторите.';
  }
  return 'Не удалось загрузить обзор. Повторите чуть позже.';
}

/**
 * «Обзор сервиса»: the service owner's numbers — doctors, diaries, phones, records, alerts, a weekly
 * chart and a table of doctors. Aggregates the server already sees (ADR-0026 §7); no patient is
 * named. The tiles keep their places while the numbers load.
 */
export function ServiceOverviewPage(props: {
  readonly session: DoctorSession;
  readonly onBack: () => void;
}): JSX.Element {
  const [stats, { refetch }] = createResource(() => diaryAdmin.stats(doctorApi(props.session)));
  const shown = (): DiaryAdminStats => (stats.error ? EMPTY_STATS : (stats() ?? EMPTY_STATS));
  const loading = (): boolean => stats.loading && stats() === undefined;
  const tiles = createMemo(() => overviewTiles(shown()));
  const bars = createMemo(() => weekBars(shown().weeks));
  const now = (): Date => new Date();

  const headerActions = createMemo((): readonly HeaderAction[] => [
    {
      id: 'refresh',
      label: 'Обновить',
      icon: 'refresh',
      priority: 2,
      disabled: stats.loading,
      onSelect: () => void refetch(),
    },
  ]);

  return (
    <div class="diary-patient service-overview" data-testid="service-overview">
      <Page
        hero={PAGE_HEROES.patients}
        navigation={
          <NavBack class="knowledge-back-button" aria-label="К дневникам" onClick={props.onBack} />
        }
        title={
          <Heading depth={1} class="service-overview__title">
            Обзор сервиса
          </Heading>
        }
        headerActions={headerActions()}
        help={
          <p>
            Только числа, которые сервер и так знает: сколько врачей, дневников, телефонов и
            записей. Содержимое записей зашифровано, имена и данные пациентов сюда не попадают.
          </p>
        }
      />
      <div
        class="service-overview__body"
        classList={{ 'service-overview__body--loading': loading() || Boolean(stats.error) }}
        aria-busy={loading()}
      >
        <StatGrid columns={4} class="service-overview__tiles">
          <For each={tiles()}>
            {(tile) => (
              <StatCard
                value={tile.value}
                label={tile.label}
                hint={tile.hint}
                icon={tile.icon}
                tone={tile.tone}
                compact
              />
            )}
          </For>
        </StatGrid>

        <section class="service-overview__section" aria-label="Новые врачи и дневники по неделям">
          <h2 class="service-overview__heading">Новые по неделям</h2>
          <div class="service-overview__legend">
            <span class="service-overview__key service-overview__key--doctors">врачи</span>
            <span class="service-overview__key service-overview__key--patients">дневники</span>
          </div>
          <ol class="service-overview__chart" data-testid="service-weeks">
            <For
              each={bars()}
              fallback={
                <For each={Array.from({ length: 12 })}>
                  {() => <li class="service-overview__week service-overview__week--empty" />}
                </For>
              }
            >
              {(bar) => (
                <li class="service-overview__week" title={bar.spoken} aria-label={bar.spoken}>
                  <span class="service-overview__bars">
                    <span
                      class="service-overview__bar service-overview__bar--doctors"
                      style={{ height: `${bar.doctorsHeight}%` }}
                    />
                    <span
                      class="service-overview__bar service-overview__bar--patients"
                      style={{ height: `${bar.patientsHeight}%` }}
                    />
                  </span>
                  <span class="service-overview__week-label">{bar.label}</span>
                </li>
              )}
            </For>
          </ol>
        </section>

        <section class="service-overview__section service-overview__doctors">
          <h2 class="service-overview__heading">Врачи</h2>
          <Show
            when={!stats.error}
            fallback={
              <div class="service-overview__failure" role="alert">
                <p class="service-overview__failure-text">{failureText(stats.error)}</p>
                <Button variant="secondary" onClick={() => void refetch()}>
                  Повторить
                </Button>
              </div>
            }
          >
            <HorizontalScroller
              class="service-overview__scroller"
              controls
              hideScrollbar
              controlLabel="таблицу врачей"
            >
              <table class="service-overview__table" data-testid="service-doctors">
                <thead>
                  <tr>
                    <th class="service-overview__cell service-overview__cell--head">Врач</th>
                    <th class="service-overview__cell service-overview__cell--head service-overview__cell--number">
                      Дневники
                    </th>
                    <th class="service-overview__cell service-overview__cell--head service-overview__cell--number">
                      С записью за неделю
                    </th>
                    <th class="service-overview__cell service-overview__cell--head">
                      Последняя запись
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={shown().doctorRows}>
                    {(row) => (
                      <tr>
                        <td class="service-overview__cell">
                          <span class="service-overview__name">{row.name}</span>
                          <span class="service-overview__email">{row.email}</span>
                        </td>
                        <td class="service-overview__cell service-overview__cell--number">
                          {row.patients}
                        </td>
                        <td class="service-overview__cell service-overview__cell--number">
                          {row.activePatients}
                        </td>
                        <td class="service-overview__cell">
                          {lastActivityLabel(row.lastActivityAt, now())}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </HorizontalScroller>
            <p class="service-overview__foot">
              {stats()
                ? `${shown().doctors.total} ${pluralize(shown().doctors.total, 'врач', 'врача', 'врачей')}, дневники есть у ${shown().doctors.withPatients}`
                : '\u00a0'}
            </p>
          </Show>
        </section>
      </div>
    </div>
  );
}
