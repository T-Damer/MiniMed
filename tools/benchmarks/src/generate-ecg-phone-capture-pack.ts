import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ECG_PHONE_CAPTURE_PROFILE = {
  leads: 12,
  layout: '12x1',
  sample_rate_hz: 500,
  duration_seconds: 5,
  speed_mm_per_s: 50,
  gain_mm_per_mV: 10,
  time_axis_mm: 250,
  page: 'A4 landscape',
} as const;

const LEADS = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'] as const;
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const REVISION = 'seed-20260901-v1';
const BASE_SEED = 0x20_26_09_01;

export interface EcgSyntheticReference {
  readonly schema_version: 1;
  readonly population: 'synthetic-adult-like';
  readonly is_patient_data: false;
  readonly sample_rate_hz: 500;
  readonly duration_seconds: 5;
  readonly leads: typeof LEADS;
  readonly heart_rate_bpm: number;
  readonly rr_ms: number;
  readonly values_mV: readonly (readonly number[])[];
}

export interface EcgPhoneCapturePlanCase {
  readonly case_id: string;
  readonly split: 'dev' | 'test';
  readonly base_ecg_id: string;
  readonly print_page_file: string;
  readonly print_page_sha256: string;
  readonly reference_signal_file: string;
  readonly reference_signal_sha256: string;
  readonly reference_rr_ms: number;
  readonly reference_heart_rate_bpm: number;
  readonly planned_photo_files: readonly string[];
}

export interface EcgPhoneCapturePlan {
  readonly schema_version: 1;
  readonly dataset_id: 'minimed-ecg-phone-capture-synthetic-v1';
  readonly revision: typeof REVISION;
  readonly population: 'synthetic';
  readonly is_patient_data: false;
  readonly profile: typeof ECG_PHONE_CAPTURE_PROFILE;
  readonly print_instruction: string;
  readonly cases: readonly EcgPhoneCapturePlanCase[];
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function gaussian(x: number, center: number, width: number): number {
  return Math.exp(-0.5 * ((x - center) / width) ** 2);
}

export function generateSyntheticEcgReference(index: number): EcgSyntheticReference {
  if (!Number.isInteger(index) || index < 0)
    throw new Error('ECG synthetic index must be non-negative.');
  const random = mulberry32(BASE_SEED + index);
  const heartRate = 52 + Math.floor(random() * 44);
  const rrSeconds = 60 / heartRate;
  const pScale = 0.8 + random() * 0.35;
  const qrsScale = 0.8 + random() * 0.35;
  const tScale = 0.75 + random() * 0.4;
  const leadScales = [0.72, 0.58, -0.32, -0.56, 0.44, 0.22, -0.42, -0.62, 0.62, 0.74, 0.68, 0.48];
  const sampleCount =
    ECG_PHONE_CAPTURE_PROFILE.sample_rate_hz * ECG_PHONE_CAPTURE_PROFILE.duration_seconds;
  const values = leadScales.map((leadScale, leadIndex) => {
    const leadOffset = (leadIndex - 5.5) * 0.003;
    return Array.from({ length: sampleCount }, (_, sampleIndex) => {
      const time = sampleIndex / ECG_PHONE_CAPTURE_PROFILE.sample_rate_hz;
      const phase = (time + rrSeconds * 0.72) % rrSeconds;
      const p = 0.075 * pScale * gaussian(phase, 0.11 * rrSeconds, 0.025);
      const q = -0.07 * qrsScale * gaussian(phase, 0.195 * rrSeconds, 0.009);
      const r = 0.58 * qrsScale * gaussian(phase, 0.21 * rrSeconds, 0.01);
      const s = -0.16 * qrsScale * gaussian(phase, 0.228 * rrSeconds, 0.012);
      const t = 0.18 * tScale * gaussian(phase, 0.42 * rrSeconds, 0.055);
      const drift = 0.008 * Math.sin(2 * Math.PI * (0.18 + leadIndex * 0.005) * time);
      return Number(((p + q + r + s + t) * leadScale + drift + leadOffset).toFixed(6));
    });
  });
  return {
    schema_version: 1,
    population: 'synthetic-adult-like',
    is_patient_data: false,
    sample_rate_hz: ECG_PHONE_CAPTURE_PROFILE.sample_rate_hz,
    duration_seconds: ECG_PHONE_CAPTURE_PROFILE.duration_seconds,
    leads: LEADS,
    heart_rate_bpm: heartRate,
    rr_ms: Math.round(60_000 / heartRate / 2) * 2,
    values_mV: values,
  };
}

function pathData(values: readonly number[], baseline: number): string {
  return values
    .map((value, index) => {
      const x = 28 + (index / ECG_PHONE_CAPTURE_PROFILE.sample_rate_hz) * 50;
      const y = baseline - value * ECG_PHONE_CAPTURE_PROFILE.gain_mm_per_mV;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(3)},${y.toFixed(3)}`;
    })
    .join(' ');
}

export function renderEcgCapturePageSvg(caseId: string, reference: EcgSyntheticReference): string {
  const traces = reference.values_mV
    .map((values, index) => {
      const baseline = 19 + index * 15.5;
      return `<text x="3" y="${(baseline + 1.5).toFixed(1)}" font-family="sans-serif" font-size="3" fill="#0b4f91">${LEADS[index]}</text><path class="calibration" d="M16 ${baseline} L18 ${baseline} L18 ${baseline - 10} L26 ${baseline - 10} L26 ${baseline} L28 ${baseline}"/><path class="trace" d="${pathData(values ?? [], baseline)}"/>`;
    })
    .join('');
  const ticks = Array.from({ length: 6 }, (_, second) => {
    const x = 28 + second * 50;
    return `<path class="tick" d="M${x} 202 L${x} 205"/><text x="${x}" y="208" font-family="sans-serif" font-size="2.5" fill="#333" text-anchor="middle">${second}s</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210" data-case-id="${caseId}" data-time-axis-mm="250">
  <defs>
    <pattern id="small-grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#e8b8b8" stroke-width="0.08"/></pattern>
    <pattern id="large-grid" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="url(#small-grid)"/><path d="M5 0H0V5" fill="none" stroke="#d98f8f" stroke-width="0.16"/></pattern>
    <style>.trace,.calibration{fill:none;stroke:#0b4f91;stroke-width:.28;stroke-linecap:round;stroke-linejoin:round}.calibration{stroke-width:.35}.tick{stroke:#333;stroke-width:.25}</style>
  </defs>
  <rect width="297" height="210" fill="#fffef2"/>
  <rect x="14" y="8" width="270" height="192" fill="url(#large-grid)"/>
  <text x="4" y="5" font-family="sans-serif" font-size="2.7" font-weight="700" fill="#8a1c1c">SYNTHETIC · NO PATIENT DATA · NOT FOR DIAGNOSIS</text>
  <text x="293" y="5" font-family="sans-serif" font-size="3" fill="#222" text-anchor="end">12×1 · 50 mm/s · 10 mm/mV · 5.0 s · ${caseId}</text>
  ${traces}${ticks}
</svg>\n`;
}

function renderCapturePackHtml(cases: readonly EcgPhoneCapturePlanCase[]): string {
  const pages = cases
    .map(
      (item) =>
        `<img class="page" src="${item.print_page_file}" alt="Synthetic ECG ${item.case_id}">`,
    )
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>MiniMed ECG phone capture pack</title><style>@page{size:A4 landscape;margin:0}body{margin:0;font-family:system-ui,sans-serif}.instructions{padding:20px;max-width:800px}.page{display:block;width:297mm;height:210mm;break-after:page;page-break-after:always}@media print{.instructions{display:none}}</style></head><body><section class="instructions"><h1>MiniMed ECG phone capture pack</h1><p>Печатайте в масштабе 100%. Отключите «Вписать в страницу» / fit-to-page. Каждая страница синтетическая и не содержит данных пациента.</p></section>${pages}</body></html>\n`;
}

function assertExternalOutput(output: string): string {
  const target = resolve(output);
  const relativeToProject = relative(PROJECT_ROOT, target);
  const outside =
    relativeToProject === '..' ||
    relativeToProject.startsWith(`..${sep}`) ||
    isAbsolute(relativeToProject);
  if (!relativeToProject || !outside)
    throw new Error('Capture-pack output must be outside the repository.');
  if (existsSync(target)) throw new Error(`Output already exists: ${target}`);
  return target;
}

export function generateEcgPhoneCapturePack(output: string, count = 60): EcgPhoneCapturePlan {
  if (!Number.isInteger(count) || count < 2)
    throw new Error('Capture-pack count must be an integer of at least 2.');
  const target = assertExternalOutput(output);
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true });
  const staging = mkdtempSync(resolve(parent, '.minimed-ecg-phone-capture-'));
  try {
    mkdirSync(resolve(staging, 'pages'));
    mkdirSync(resolve(staging, 'references'));
    const cases: EcgPhoneCapturePlanCase[] = [];
    const testStart = Math.floor(count / 2);
    for (let index = 0; index < count; index += 1) {
      const caseId = `synthetic-${String(index + 1).padStart(3, '0')}`;
      const reference = generateSyntheticEcgReference(index);
      const referenceText = `${JSON.stringify(reference)}\n`;
      const svg = renderEcgCapturePageSvg(caseId, reference);
      const printPageFile = `pages/${caseId}.svg`;
      const referenceSignalFile = `references/${caseId}.json`;
      writeFileSync(resolve(staging, printPageFile), svg, { encoding: 'utf8', flag: 'wx' });
      writeFileSync(resolve(staging, referenceSignalFile), referenceText, {
        encoding: 'utf8',
        flag: 'wx',
      });
      cases.push({
        case_id: caseId,
        split: index < testStart ? 'dev' : 'test',
        base_ecg_id: `synthetic-base-${String(index + 1).padStart(3, '0')}`,
        print_page_file: printPageFile,
        print_page_sha256: sha256(svg),
        reference_signal_file: referenceSignalFile,
        reference_signal_sha256: sha256(referenceText),
        reference_rr_ms: reference.rr_ms,
        reference_heart_rate_bpm: reference.heart_rate_bpm,
        planned_photo_files: [`photos/device-a/${caseId}.jpg`, `photos/device-b/${caseId}.jpg`],
      });
    }
    const plan: EcgPhoneCapturePlan = {
      schema_version: 1,
      dataset_id: 'minimed-ecg-phone-capture-synthetic-v1',
      revision: REVISION,
      population: 'synthetic',
      is_patient_data: false,
      profile: ECG_PHONE_CAPTURE_PROFILE,
      print_instruction: 'Print at 100%; disable fit-to-page.',
      cases,
    };
    writeFileSync(resolve(staging, 'capture-plan.json'), `${JSON.stringify(plan, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    writeFileSync(resolve(staging, 'capture-pack.html'), renderCapturePackHtml(cases), {
      encoding: 'utf8',
      flag: 'wx',
    });
    renameSync(staging, target);
    return plan;
  } catch (cause) {
    rmSync(staging, { recursive: true, force: true });
    throw cause;
  }
}

interface CliOptions {
  readonly output: string;
  readonly count: number;
}

function cliOptions(args: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if ((flag !== '--output' && flag !== '--count') || !value || value.startsWith('--')) {
      throw new Error('Usage: --output DIR [--count N]');
    }
    if (values.has(flag)) throw new Error(`Duplicate CLI flag ${flag}.`);
    values.set(flag, value);
  }
  const output = values.get('--output');
  if (!output) throw new Error('Usage: --output DIR [--count N]');
  const countText = values.get('--count');
  const count = countText === undefined ? 60 : Number(countText);
  if (!Number.isInteger(count) || count < 2)
    throw new Error('--count must be an integer of at least 2.');
  return { output, count };
}

export function runEcgPhoneCapturePackCli(args = process.argv.slice(2)): number {
  try {
    const options = cliOptions(args);
    const plan = generateEcgPhoneCapturePack(options.output, options.count);
    const manifestPath = resolve(options.output, 'capture-plan.json');
    process.stdout.write(
      `${JSON.stringify({ output: resolve(options.output), cases: plan.cases.length, capture_plan_sha256: sha256(readFileSync(manifestPath)) }, null, 2)}\n`,
    );
    return 0;
  } catch (cause) {
    process.stderr.write(
      `ECG phone capture pack generation failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runEcgPhoneCapturePackCli();
}
