// RX2: a decoded one-line reading of a dose rule for the reviewer (the rule JSON stays authoritative).
import { type DoseRule, PIECE_KINDS } from '@localmed/contracts';

const ROUTE_NAMES: readonly [number, string][] = [
  [1, 'oral'],
  [2, 'iv'],
  [4, 'im'],
  [8, 'sc'],
  [16, 'inhaled'],
  [32, 'topical'],
  [64, 'rectal'],
  [128, 'sublingual'],
  [256, 'eye/ear/nose'],
  [512, 'vaginal'],
];
const GROUP_NAMES: readonly [number, string][] = [
  [1, 'adult'],
  [2, 'child'],
  [4, 'elderly'],
  [8, 'newborn'],
  [16, 'infant'],
  [32, 'adolescent'],
];
const COND_NAMES: readonly [number, string][] = [
  [1, 'renal'],
  [2, 'hepatic'],
  [4, 'dialysis'],
];
const ROLE_NAMES = ['', 'initial', 'maintenance', 'loading', 'single'];
const UNIT_NAMES = ['mg', 'ml', 'IU', 'U', 'mmol', 'drop', 'dose', 'piece'];
const PIECE_NAMES: readonly string[] = PIECE_KINDS;

function bitNames(value: number | undefined, names: readonly [number, string][]): string {
  return names
    .filter(([bit]) => ((value ?? 0) & bit) !== 0)
    .map(([, name]) => name)
    .join('+');
}

const years = (days: number): string => `${Math.round((days / 365.25) * 100) / 100}y`;

export function describeRule(rule: DoseRule): string {
  const parts: string[] = [];
  parts.push(rule.k === 0 ? 'DOSE' : rule.k === 1 ? 'CAP' : 'DURATION');
  const populations: string[] = [];
  if (rule.g) populations.push(`group=${bitNames(rule.g, GROUP_NAMES)}`);
  if (rule.p0 !== undefined) populations.push(`age>=${years(rule.p0)}`);
  if (rule.p1 !== undefined) populations.push(`age<${years(rule.p1)}`);
  if (rule.w0 !== undefined) populations.push(`wt>=${rule.w0 / 10}kg`);
  if (rule.w1 !== undefined) populations.push(`wt<=${rule.w1 / 10}kg`);
  if (rule.or) populations.push('(age OR weight)');
  if (rule.c) populations.push(`cond=${bitNames(rule.c, COND_NAMES)}`);
  parts.push(`pop[${populations.join(' ') || 'none'}]`);
  if (rule.d0 !== undefined || rule.d1 !== undefined) {
    const unit = UNIT_NAMES[rule.u ?? 0];
    const range =
      rule.d1 === undefined || rule.d1 === rule.d0 ? `${rule.d0}` : `${rule.d0 ?? '?'}-${rule.d1}`;
    const per = rule.pk === 1 ? '/kg' : rule.pk === 2 ? '/m2' : '';
    const scope =
      rule.k === 1
        ? `cap-${['single', 'day', 'course'][rule.bs ?? 0]}`
        : rule.bs === 1
          ? 'per DAY'
          : 'per INTAKE';
    parts.push(`${rule.up ? 'up to ' : ''}${range} ${unit}${per} ${scope}`);
  }
  if (rule.q0 !== undefined) {
    parts.push(
      `pieces ${rule.q0}${rule.q1 !== undefined ? `-${rule.q1}` : ''} ${PIECE_NAMES[rule.qu ?? 9]}${rule.pm !== undefined ? ` x${rule.pm}mg` : ''}`,
    );
  }
  if (rule.f0 !== undefined) {
    parts.push(
      `freq ${rule.f0}${rule.f1 !== undefined && rule.f1 !== rule.f0 ? `-${rule.f1}` : ''}x per ${rule.fp ?? 1}d`,
    );
  }
  if (rule.t0 !== undefined) {
    parts.push(
      `duration ${rule.tm ? 'max ' : ''}${rule.t0}${rule.t1 !== undefined && rule.t1 !== rule.t0 ? `-${rule.t1}` : ''}d`,
    );
  }
  if (rule.rt) parts.push(`route=${bitNames(rule.rt, ROUTE_NAMES)}`);
  if (rule.fm) parts.push(`formbits=${rule.fm}`);
  if (rule.ro) parts.push(`role=${ROLE_NAMES[rule.ro]}`);
  return parts.join(' | ');
}
