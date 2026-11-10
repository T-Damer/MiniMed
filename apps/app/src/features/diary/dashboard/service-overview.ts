/**
 * «Обзор сервиса» (the service owner's page): turns the server's aggregates (`DiaryAdminStats`)
 * into declared tiles, chart bars and table cells. Pure, so it is unit-tested without a DOM. The
 * page renders these lists and never branches on one tile (AGENTS.md «Schema first»).
 */
import type { DiaryAdminStats } from '@localmed/contracts';

import type { AppGlyphName } from '@/components/AppGlyph';
import type { StatTone } from '@/components/stat-card';
import { pluralize } from '@/diary/diary-format';

export interface OverviewTile {
  readonly id: string;
  readonly value: string;
  readonly label: string;
  readonly hint: string;
  readonly icon: AppGlyphName;
  readonly tone: StatTone;
}

/** «57 %»; a dash when there is nothing to divide. */
export function shareLabel(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)} %` : '—';
}

/** Under the tiles: where the prescription and adherence figures come from. */
export const TOTALS_NOTE =
  'Назначения и приём — итоги, которые присылают приложения врачей (только по их пациентам-владельцам, без данных о пациентах); обновляются, когда врач открывает дневники.';

export function overviewTiles(stats: DiaryAdminStats): readonly OverviewTile[] {
  const { doctors, patients, phones, records, alerts } = stats;
  const { adherence7, adherence30 } = stats;
  return [
    {
      id: 'doctors',
      value: String(doctors.total),
      label: pluralize(doctors.total, 'врач', 'врача', 'врачей'),
      hint: `+${doctors.new7} за неделю, +${doctors.new30} за месяц`,
      icon: 'users',
      tone: 'accent',
    },
    {
      id: 'patients',
      value: String(patients.total),
      label: pluralize(patients.total, 'дневник', 'дневника', 'дневников'),
      hint: `+${patients.new7} за неделю, +${patients.new30} за месяц`,
      icon: 'notes',
      tone: 'accent',
    },
    {
      id: 'phones',
      value: String(patients.withPhone),
      label: 'с телефоном пациента',
      hint: shareLabel(patients.withPhone, patients.total),
      icon: 'device-mobile',
      tone: 'good',
    },
    {
      id: 'carers',
      value: String(phones.carer),
      label: pluralize(phones.carer, 'телефон близкого', 'телефона близких', 'телефонов близких'),
      hint: `в ${patients.withCarer} ${pluralize(patients.withCarer, 'дневнике', 'дневниках', 'дневниках')}`,
      icon: 'heartbeat',
      tone: 'default',
    },
    {
      id: 'records',
      value: String(records.total),
      label: pluralize(records.total, 'запись', 'записи', 'записей'),
      hint: `${records.last7} за неделю, ${records.last30} за месяц`,
      icon: 'note-pencil',
      tone: 'default',
    },
    {
      id: 'prescriptions',
      value: String(stats.prescriptions),
      label: 'Назначений',
      hint: `в ${stats.diariesWithPlan} ${pluralize(stats.diariesWithPlan, 'дневнике', 'дневниках', 'дневниках')}`,
      icon: 'pill',
      tone: 'accent',
    },
    {
      id: 'adherence',
      value: `${shareLabel(adherence7.done, adherence7.total)} / ${shareLabel(adherence30.done, adherence30.total)}`,
      label: 'Приём по плану, 7 дней / 30 дней',
      hint: `${adherence30.done} из ${adherence30.total} за 30 дней`,
      icon: 'list-checks',
      tone: 'good',
    },
    {
      id: 'active',
      value: String(patients.active7),
      label: 'дневников с записью за неделю',
      hint: `${shareLabel(patients.active7, patients.total)} · за месяц ${patients.active30}`,
      icon: 'chart-line',
      tone: 'good',
    },
    {
      id: 'alerts',
      value: String(alerts.open),
      label: 'срочных отметок открыто',
      hint: `всего ${alerts.total}`,
      icon: 'warning',
      tone: alerts.open > 0 ? 'danger' : 'default',
    },
    {
      id: 'withdrawn',
      value: String(patients.withdrawn),
      label: 'отозвали согласие',
      hint: 'дневники закрыты',
      icon: 'close',
      tone: 'default',
    },
  ];
}

export interface WeekBar {
  readonly start: string;
  /** «9 ноя»: the Monday of the week. */
  readonly label: string;
  readonly doctors: number;
  readonly patients: number;
  /** Heights as a share of the tallest bar (0–100); a non-zero count is never flatter than 4. */
  readonly doctorsHeight: number;
  readonly patientsHeight: number;
  readonly spoken: string;
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function weekLabel(start: string): string {
  const [, month = '1', day = '1'] = start.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ''}`.trim();
}

const height = (count: number, peak: number): number =>
  count === 0 || peak === 0 ? 0 : Math.max(4, Math.round((count / peak) * 100));

export function weekBars(weeks: DiaryAdminStats['weeks']): readonly WeekBar[] {
  const peak = Math.max(0, ...weeks.flatMap((week) => [week.newDoctors, week.newPatients]));
  return weeks.map((week) => ({
    start: week.start,
    label: weekLabel(week.start),
    doctors: week.newDoctors,
    patients: week.newPatients,
    doctorsHeight: height(week.newDoctors, peak),
    patientsHeight: height(week.newPatients, peak),
    spoken: `Неделя с ${weekLabel(week.start)}: врачей ${week.newDoctors}, дневников ${week.newPatients}`,
  }));
}

/** «сегодня», «вчера», «5 дн. назад», «нет записей». */
export function lastActivityLabel(at: string | null, now: Date): string {
  if (!at) return 'нет записей';
  const time = new Date(at);
  if (Number.isNaN(time.getTime())) return 'нет записей';
  const startOfDay = (value: Date): number =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(time)) / 86_400_000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  return `${days} дн. назад`;
}

/** «12 сен»: the day a doctor's app last reported, in the viewer's time. */
function reportedLabel(at: string): string {
  const time = new Date(at);
  if (Number.isNaN(time.getTime())) return '';
  return `${time.getDate()} ${MONTHS[time.getMonth()] ?? ''}`.trim();
}

const THIRTY_DAYS_MS = 30 * 86_400_000;

export interface DoctorTotalsCells {
  readonly prescriptions: string;
  /** «82 %», with the report's day when it is older than 30 days: «82 % · 12 сен». */
  readonly adherence: string;
  readonly title: string;
}

/** The two «итоги приложения врача» cells of a doctor's row; dashes when the app never reported. */
export function doctorTotalsCells(
  row: Pick<DiaryAdminStats['doctorRows'][number], 'prescriptions' | 'adherence30' | 'totalsAt'>,
  now: Date,
): DoctorTotalsCells {
  if (row.totalsAt === null) {
    return { prescriptions: '—', adherence: '—', title: 'Приложение врача ещё не присылало итоги' };
  }
  const reported = new Date(row.totalsAt);
  const stale =
    !Number.isNaN(reported.getTime()) && now.getTime() - reported.getTime() > THIRTY_DAYS_MS;
  const share = row.adherence30 === null ? '—' : `${Math.round(row.adherence30 * 100)} %`;
  const day = reportedLabel(row.totalsAt);
  return {
    prescriptions: row.prescriptions === null ? '—' : String(row.prescriptions),
    adherence: stale && day ? `${share} · ${day}` : share,
    title: day ? `Итоги присланы ${day}` : '',
  };
}
