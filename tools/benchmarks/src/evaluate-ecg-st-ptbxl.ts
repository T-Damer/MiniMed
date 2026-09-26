/**
 * Compares MiniMed ST-at-J measurement and Fourth UDMI / ESC 2023 ST rules with PTB-XL+ machine
 * measurements. Data: PTB-XL 1.0.3 and PTB-XL+ 1.0.1 (PhysioNet, CC BY 4.0; Wagner et al. 2020,
 * Strodthoff et al. 2023). Raw data stays outside Git; only a small attributed fixture is written.
 *
 * Usage: tsx src/evaluate-ecg-st-ptbxl.ts --dir <ptbxl dir> [--medians 60] [--fixture out.json]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ECG_STANDARD_LEADS,
  type EcgLeadName,
} from '../../../apps/app/src/features/calculators/ecg-model-contract';
import { type EcgLeadSt, evaluateEcgSt } from '../../../apps/app/src/features/calculators/ecg-st';
import type {
  EcgAdultAgeBand,
  EcgSex,
} from '../../../apps/app/src/features/calculators/ecg-st-criteria';
import { type EcgCsvTable, parseEcgCsv, requireEcgCsvColumn } from './ecg-csv';

// PTB-XL has no acute-STEMI statement: STE_ (non-specific ST elevation) is the only elevation label.
// INJ* means subendocardial injury, an ST-depression pattern; AMI/IMI mostly describe established
// infarction and are not an ST-elevation reference.
const ELEVATION_LABELS = ['STE_'] as const;
const DEPRESSION_LABELS = ['STD_', 'INJAS', 'INJAL', 'INJIN', 'INJLA', 'INJIL'] as const;
const MEDIANS_URL = 'https://physionet.org/files/ptb-xl-plus/1.0.1/median_beats/unig';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

interface RecordInfo {
  readonly id: number;
  readonly age: number;
  readonly sex: EcgSex;
  readonly fold: number;
  readonly codes: ReadonlySet<string>;
}

interface Features {
  readonly st: Map<EcgLeadName, number>;
  readonly qrsMs?: number;
  readonly pOffMs?: number;
  readonly qrsOnMs?: number;
  readonly qrsOffMs?: number;
}

function readTable(path: string): EcgCsvTable {
  return parseEcgCsv(readFileSync(path, 'utf8'), path);
}

function number(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readRecords(path: string): Map<number, RecordInfo> {
  const table = readTable(path);
  const id = requireEcgCsvColumn(table, ['ecg_id'], 'ecg_id');
  const age = requireEcgCsvColumn(table, ['age'], 'age');
  const sex = requireEcgCsvColumn(table, ['sex'], 'sex');
  const fold = requireEcgCsvColumn(table, ['strat_fold'], 'strat_fold');
  const codes = requireEcgCsvColumn(table, ['scp_codes'], 'scp_codes');
  const records = new Map<number, RecordInfo>();
  for (const row of table.rows) {
    const recordId = number(row.values[id]);
    const recordAge = number(row.values[age]);
    const recordSex = number(row.values[sex]);
    if (recordId === undefined || recordAge === undefined || recordSex === undefined) continue;
    records.set(recordId, {
      id: recordId,
      age: recordAge,
      // PTB-XL codes sex as 0 = male, 1 = female.
      sex: recordSex === 1 ? 'female' : 'male',
      fold: number(row.values[fold]) ?? 0,
      codes: new Set(
        [...(row.values[codes] ?? '').matchAll(/'([A-Z0-9_]+)'/gu)].map((m) => m[1] ?? ''),
      ),
    });
  }
  return records;
}

function readFeatures(path: string): Map<number, Features> {
  const table = readTable(path);
  const id = requireEcgCsvColumn(table, ['ecg_id'], 'ecg_id');
  const optional = (name: string) => table.headers.indexOf(name);
  const stColumns = ECG_STANDARD_LEADS.map((lead) => [lead, optional(`ST_Amp_${lead}`)] as const);
  const qrs = optional('QRS_Dur_Global');
  const pOff = optional('P_Off_Global');
  const qrsOn = optional('QRS_On_Global');
  const qrsOff = optional('QRS_Off_Global');
  const features = new Map<number, Features>();
  for (const row of table.rows) {
    const recordId = number(row.values[id]);
    if (recordId === undefined) continue;
    const st = new Map<EcgLeadName, number>();
    for (const [lead, column] of stColumns) {
      const value = column >= 0 ? number(row.values[column]) : undefined;
      if (value !== undefined) st.set(lead, value);
    }
    const pick = (column: number) => (column >= 0 ? number(row.values[column]) : undefined);
    const qrsMs = pick(qrs);
    const pOffMs = pick(pOff);
    const qrsOnMs = pick(qrsOn);
    const qrsOffMs = pick(qrsOff);
    features.set(recordId, {
      st,
      ...(qrsMs === undefined ? {} : { qrsMs }),
      ...(pOffMs === undefined ? {} : { pOffMs }),
      ...(qrsOnMs === undefined ? {} : { qrsOnMs }),
      ...(qrsOffMs === undefined ? {} : { qrsOffMs }),
    });
  }
  return features;
}

function ageBand(age: number): EcgAdultAgeBand {
  return age >= 40 ? '40-plus' : 'under-40';
}

function flags(record: RecordInfo, feature: Features) {
  const leads: EcgLeadSt[] = [...feature.st].map(([lead, stMv]) => ({
    lead,
    stMv,
    region: lead,
    edited: false,
  }));
  const result = evaluateEcgSt({
    measurement: { leads, missing: {} },
    sex: record.sex,
    ageBand: ageBand(record.age),
    ...(feature.qrsMs === undefined ? {} : { qrsMs: feature.qrsMs }),
  });
  const ids = new Set(result.findings.map((finding) => finding.id));
  return {
    elevation: ids.has('st-elevation'),
    depression: ids.has('st-depression'),
    wideQrs: ids.has('st-wide-qrs'),
  };
}

interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

function summary(matrix: Confusion) {
  const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 1000 : null);
  return {
    ...matrix,
    sensitivity: ratio(matrix.tp, matrix.tp + matrix.fn),
    specificity: ratio(matrix.tn, matrix.tn + matrix.fp),
    ppv: ratio(matrix.tp, matrix.tp + matrix.fp),
  };
}

function add(matrix: Confusion, predicted: boolean, actual: boolean): void {
  if (predicted && actual) matrix.tp += 1;
  else if (predicted) matrix.fp += 1;
  else if (actual) matrix.fn += 1;
  else matrix.tn += 1;
}

/** WFDB format 212: two 12-bit samples in three bytes, frames interleave the 12 leads. */
function parseMedianBeat(header: string, data: Uint8Array): Map<EcgLeadName, Float64Array> {
  const lines = header.trim().split('\n');
  const [, channelText, , lengthText] = (lines[0] ?? '').trim().split(/\s+/u);
  const channels = Number(channelText);
  const length = Number(lengthText);
  const signals = lines.slice(1, 1 + channels).map((line) => {
    const parts = line.trim().split(/\s+/u);
    const gainMatch = /^([\d.]+)\((-?\d+)\)/u.exec(parts[2] ?? '');
    return {
      gain: Number(gainMatch?.[1]),
      baseline: Number(gainMatch?.[2] ?? 0),
      name: parts.at(-1) as EcgLeadName,
    };
  });
  const values: number[] = [];
  for (let index = 0; index + 2 < data.length && values.length < channels * length; index += 3) {
    const b0 = data[index] ?? 0;
    const b1 = data[index + 1] ?? 0;
    const b2 = data[index + 2] ?? 0;
    for (const raw of [b0 | ((b1 & 0x0f) << 8), b2 | ((b1 & 0xf0) << 4)])
      values.push(raw > 2047 ? raw - 4096 : raw);
  }
  const output = new Map<EcgLeadName, Float64Array>();
  signals.forEach((signal, channel) => {
    const samples = new Float64Array(length);
    for (let sample = 0; sample < length; sample += 1)
      // PTB-XL+ median-beat headers label the unit as mV, but samples are µV: a record's 565-unit
      // lead-II peak matches its Uni-G R_Amp_II of 0.562 mV. Convert to mV explicitly.
      samples[sample] =
        ((values[sample * channels + channel] ?? 0) - signal.baseline) / signal.gain / 1000;
    output.set(signal.name, samples);
  });
  return output;
}

async function cachedFetch(url: string, path: string): Promise<Uint8Array> {
  if (existsSync(path)) return new Uint8Array(readFileSync(path));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  writeFileSync(path, bytes);
  return bytes;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

async function main(): Promise<void> {
  const dir = argument('--dir');
  if (!dir) throw new Error('--dir <ptbxl directory> is required.');
  const medianCount = Number(argument('--medians') ?? 60);
  const records = readRecords(join(dir, 'ptbxl_database.csv'));
  const ge = readFeatures(join(dir, '12sl_features.csv'));
  const unig = readFeatures(join(dir, 'unig_features.csv'));

  const complete = (feature: Features | undefined) =>
    feature !== undefined && ECG_STANDARD_LEADS.every((lead) => feature.st.has(lead));
  const adults = [...records.values()].filter((record) => record.age >= 18);
  const rules = {
    elevation: {
      '12SL': { tp: 0, fp: 0, fn: 0, tn: 0 },
      'Uni-G': { tp: 0, fp: 0, fn: 0, tn: 0 },
    },
    depression: {
      '12SL': { tp: 0, fp: 0, fn: 0, tn: 0 },
      'Uni-G': { tp: 0, fp: 0, fn: 0, tn: 0 },
    },
  };
  const agreement = { both: 0, same: 0, geOnly: 0, unigOnly: 0 };
  const leadDifferences = new Map<EcgLeadName, number[]>();
  let wideQrs = 0;
  let evaluated = 0;
  const flaggedLabels = new Map<string, number>();
  let flagged = 0;
  for (const record of adults) {
    const geFeature = ge.get(record.id);
    const unigFeature = unig.get(record.id);
    if (!complete(geFeature) || !complete(unigFeature) || !geFeature || !unigFeature) continue;
    evaluated += 1;
    const elevationLabel = ELEVATION_LABELS.some((code) => record.codes.has(code));
    const depressionLabel = DEPRESSION_LABELS.some((code) => record.codes.has(code));
    const geFlags = flags(record, geFeature);
    const unigFlags = flags(record, unigFeature);
    if (geFlags.wideQrs) wideQrs += 1;
    if (geFlags.elevation) {
      flagged += 1;
      for (const code of record.codes) flaggedLabels.set(code, (flaggedLabels.get(code) ?? 0) + 1);
    }
    add(rules.elevation['12SL'], geFlags.elevation, elevationLabel);
    add(rules.elevation['Uni-G'], unigFlags.elevation, elevationLabel);
    add(rules.depression['12SL'], geFlags.depression, depressionLabel);
    add(rules.depression['Uni-G'], unigFlags.depression, depressionLabel);
    agreement.both += geFlags.elevation && unigFlags.elevation ? 1 : 0;
    agreement.same += geFlags.elevation === unigFlags.elevation ? 1 : 0;
    agreement.geOnly += geFlags.elevation && !unigFlags.elevation ? 1 : 0;
    agreement.unigOnly += !geFlags.elevation && unigFlags.elevation ? 1 : 0;
    for (const lead of ECG_STANDARD_LEADS) {
      const difference = (geFeature.st.get(lead) ?? 0) - (unigFeature.st.get(lead) ?? 0);
      leadDifferences.set(lead, [...(leadDifferences.get(lead) ?? []), Math.abs(difference)]);
    }
  }

  // Our J-point definition on Uni-G median beats versus Uni-G's own ST_Amp at J.
  const cache = join(dir, 'medians');
  mkdirSync(cache, { recursive: true });
  const sample = adults
    .filter((record) => record.fold === 10)
    .filter((record) => {
      const feature = unig.get(record.id);
      return (
        complete(feature) &&
        feature?.pOffMs !== undefined &&
        feature.qrsOnMs !== undefined &&
        feature.qrsOffMs !== undefined &&
        feature.qrsOnMs > feature.pOffMs
      );
    })
    .sort((a, b) => a.id - b.id)
    .filter((_, index, all) => index % Math.max(1, Math.floor(all.length / medianCount)) === 0)
    .slice(0, medianCount);
  const own: { lead: EcgLeadName; ours: number; unig: number }[] = [];
  for (const record of sample) {
    const feature = unig.get(record.id);
    if (!feature?.pOffMs || !feature.qrsOnMs || !feature.qrsOffMs) continue;
    const name = String(record.id).padStart(6, '0');
    const folder = `${String(Math.floor(record.id / 1000) * 1000).padStart(5, '0')}`;
    const header = new TextDecoder().decode(
      await cachedFetch(`${MEDIANS_URL}/${folder}/${name}_medians.hea`, join(cache, `${name}.hea`)),
    );
    const data = await cachedFetch(
      `${MEDIANS_URL}/${folder}/${name}_medians.dat`,
      join(cache, `${name}.dat`),
    );
    const beats = parseMedianBeat(header, data);
    // 500 Hz: one sample every 2 ms. Baseline is the PR segment from P offset to QRS onset.
    const from = Math.round(feature.pOffMs / 2);
    const to = Math.round(feature.qrsOnMs / 2);
    const j = Math.round(feature.qrsOffMs / 2);
    for (const lead of ECG_STANDARD_LEADS) {
      const beat = beats.get(lead);
      const reference = feature.st.get(lead);
      if (!beat || reference === undefined || to <= from) continue;
      const baseline = median([...beat.slice(from, to)]);
      own.push({ lead, ours: (beat[j] ?? 0) - baseline, unig: reference });
    }
  }
  const errors = own.map((item) => Math.abs(item.ours - item.unig));
  const report = {
    attribution:
      'PTB-XL 1.0.3 (Wagner et al., Sci Data 2020) and PTB-XL+ 1.0.1 (Strodthoff et al., Sci Data 2023), PhysioNet, CC BY 4.0.',
    ruleAgreement: {
      adultsWithCompleteSt: evaluated,
      wideQrsAbstained12SL: wideQrs,
      labels: { elevation: ELEVATION_LABELS, depression: DEPRESSION_LABELS },
      elevation: {
        '12SL': summary(rules.elevation['12SL']),
        'Uni-G': summary(rules.elevation['Uni-G']),
      },
      depression: {
        '12SL': summary(rules.depression['12SL']),
        'Uni-G': summary(rules.depression['Uni-G']),
      },
      elevationFlag12SLvsUniG: agreement,
      // What the 12SL-based elevation flags co-occur with: explains flags without an STE_ label.
      elevationFlagged12SL: flagged,
      elevationFlaggedTopLabels12SL: [...flaggedLabels]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([code, count]) => ({
          code,
          share: Math.round((count / Math.max(1, flagged)) * 1000) / 1000,
        })),
    },
    stAmp12SLvsUniG: Object.fromEntries(
      [...leadDifferences].map(([lead, values]) => [
        lead,
        { medianAbsMv: Math.round(median(values) * 1000) / 1000 },
      ]),
    ),
    ownJPointVsUniG: {
      records: sample.length,
      leadMeasurements: own.length,
      medianAbsErrorMv: Math.round(median(errors) * 1000) / 1000,
      meanAbsErrorMv:
        Math.round((errors.reduce((sum, e) => sum + e, 0) / Math.max(1, errors.length)) * 1000) /
        1000,
      within005Mv:
        Math.round((errors.filter((e) => e <= 0.05).length / Math.max(1, errors.length)) * 1000) /
        1000,
      within01Mv:
        Math.round((errors.filter((e) => e <= 0.1).length / Math.max(1, errors.length)) * 1000) /
        1000,
    },
  };
  console.log(JSON.stringify(report, null, 2));

  const fixturePath = argument('--fixture');
  if (fixturePath) {
    const pick = (predicate: (record: RecordInfo) => boolean, count: number) =>
      adults
        .filter((record) => record.fold === 10 && complete(ge.get(record.id)) && predicate(record))
        .sort((a, b) => a.id - b.id)
        .slice(0, count);
    const chosen = [
      ...pick((record) => ELEVATION_LABELS.some((code) => record.codes.has(code)), 5),
      ...pick((record) => {
        const feature = ge.get(record.id);
        return feature !== undefined && flags(record, feature).elevation;
      }, 6),
      ...pick((record) => DEPRESSION_LABELS.some((code) => record.codes.has(code)), 8),
      ...pick((record) => record.codes.has('NORM') && record.codes.size <= 2, 8),
    ].filter((record, index, all) => all.findIndex((other) => other.id === record.id) === index);
    writeFileSync(
      fixturePath,
      `${JSON.stringify(
        {
          attribution: report.attribution,
          note: 'GE 12SL ST_Amp at the J point (mV) from PTB-XL+ features; labels are PTB-XL SCP statements.',
          records: chosen.map((record) => {
            const feature = ge.get(record.id);
            return {
              ecgId: record.id,
              sex: record.sex,
              ageBand: ageBand(record.age),
              qrsMs: feature?.qrsMs,
              labels: [...record.codes].sort(),
              stMv: Object.fromEntries(
                ECG_STANDARD_LEADS.map((lead) => [
                  lead,
                  Math.round((feature?.st.get(lead) ?? Number.NaN) * 1000) / 1000,
                ]),
              ),
            };
          }),
        },
        null,
        2,
      )}\n`,
    );
  }
}

await main();
