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

export function overviewTiles(stats: DiaryAdminStats): readonly OverviewTile[] {
  const { doctors, patients, phones, records, alerts } = stats;
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
