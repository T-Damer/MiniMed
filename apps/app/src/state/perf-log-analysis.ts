import type { PerfEntry, PerfScript } from './perf-log';

/**
 * Reading a performance log (PERFLOG1): the numbers the in-app summary and
 * `scripts/perf-log-report.ts` show. Pure, no DOM; the input is the shared JSON file.
 */

export const PERF_LOG_FORMAT = 'minimed-perf-log';
export const PERF_LOG_FORMAT_VERSION = 1;

export interface PerfLogSession {
  readonly id: string;
  readonly startedAt: string;
  readonly version: string;
  readonly device: Readonly<Record<string, unknown>>;
  readonly durationMs: number;
  readonly droppedEntries: number;
  readonly vsyncMs?: number;
  readonly entries: readonly PerfEntry[];
}

export interface PerfLogFile {
  readonly format: typeof PERF_LOG_FORMAT;
  readonly formatVersion: number;
  readonly exportedAt: string;
  readonly summary: readonly string[];
  readonly sessions: readonly PerfLogSession[];
}

export interface Tally {
  count: number;
  ms: number;
  blockingMs: number;
}

export interface ScreenJank {
  screen: string;
  frames: number;
  dropped: number;
  over50: number;
  worst: number;
  sampledMs: number;
}

export interface EngineStats {
  engine: string;
  stretches: number;
  audioSeconds: number;
  wallMs: number;
  rtfMedian: number;
  rtfP90: number;
  rtfMax: number;
}

export interface PerfAnalysis {
  readonly sessions: number;
  readonly minutes: number;
  readonly version: string;
  readonly device: string;
  readonly longFrames: Tally;
  readonly longFramesByScreen: readonly (Tally & { key: string })[];
  readonly longFramesByFeature: readonly (Tally & { key: string })[];
  readonly longFramesByScript: readonly (Tally & { key: string })[];
  readonly worstFrames: readonly PerfEntry[];
  readonly jank: readonly ScreenJank[];
  readonly slowEvents: readonly PerfEntry[];
  readonly settle: readonly { screen: string; count: number; medianMs: number; maxMs: number }[];
  readonly recorder: {
    readonly recordings: number;
    readonly recordedMinutes: number;
    readonly engines: readonly EngineStats[];
    readonly defers: Readonly<Record<string, number>>;
    /** Long-frame time per minute while recording, and outside it. */
    readonly blockedMsPerMinRecording: number;
    readonly blockedMsPerMinOther: number;
    readonly counters: readonly {
      name: string;
      calls: number;
      callsPerSecond: number;
      msPerSecond: number;
      max: number;
    }[];
    readonly nativeCoresRecording?: number;
    readonly nativeCoresOther?: number;
  };
  readonly spans: readonly {
    name: string;
    count: number;
    medianMs: number;
    p90Ms: number;
    maxMs: number;
  }[];
  readonly memory: {
    readonly heapMbMax?: number;
    readonly heapMbLast?: number;
    readonly nativePssMbMax?: number;
    readonly availMbMin?: number;
    readonly tempCMax?: number;
    readonly thermalMax?: number;
  };
}

export const RECORDING_FEATURE = 'recorder.recording';

function add(map: Map<string, Tally>, key: string, entry: PerfEntry): void {
  const tally = map.get(key) ?? { count: 0, ms: 0, blockingMs: 0 };
  tally.count += 1;
  tally.ms += entry.d ?? 0;
  tally.blockingMs += blocking(entry);
  map.set(key, tally);
}

/** The part of a long frame past 50 ms: what held input and drawing up. */
export function blocking(entry: PerfEntry): number {
  const reported = entry.f?.['blocking'];
  if (typeof reported === 'number') return reported;
  return Math.max(0, (entry.d ?? 0) - 50);
}

function sortedTallies(map: Map<string, Tally>, limit: number): (Tally & { key: string })[] {
  return [...map]
    .map(([key, tally]) => ({ key, ...tally }))
    .sort((left, right) => right.blockingMs - left.blockingMs || right.ms - left.ms)
    .slice(0, limit);
}

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index] ?? 0;
}

/** `ConversationRecorder-Bx12_a.js` → `ConversationRecorder`; the build hash differs per release. */
export function chunkName(file: string | undefined): string {
  if (!file) return '(без файла)';
  return file.replace(/\.m?js$/u, '').replace(/-[A-Za-z0-9_-]{6,10}$/u, '') || file;
}

export function scriptKey(script: PerfScript | undefined): string {
  if (!script) return '(нет скрипта: стили, раскладка, отрисовка)';
  const where = chunkName(script.u);
  const fn = script.fn ? ` ${script.fn}` : '';
  const via = script.it ? ` ← ${script.it}${script.i ? ` ${script.i}` : ''}` : '';
  return `${where}${fn}${via}`;
}

function isLongFrame(entry: PerfEntry): boolean {
  return entry.k === 'frame' || entry.k === 'task';
}

function num(entry: PerfEntry, key: string): number | undefined {
  const value = entry.f?.[key];
  return typeof value === 'number' ? value : undefined;
}

/** Time ranges (session-relative ms) when a span of this name ran. */
function spanRanges(entries: readonly PerfEntry[], name: string): [number, number][] {
  return entries
    .filter((entry) => entry.k === 'span' && entry.n === name)
    .map((entry) => [entry.t, entry.t + (entry.d ?? 0)] as [number, number]);
}

function inRanges(t: number, ranges: readonly [number, number][]): boolean {
  return ranges.some(([from, to]) => t >= from && t <= to);
}

export function analysePerfLog(file: Pick<PerfLogFile, 'sessions'>): PerfAnalysis {
  const byScreen = new Map<string, Tally>();
  const byFeature = new Map<string, Tally>();
  const byScript = new Map<string, Tally>();
  const total: Tally = { count: 0, ms: 0, blockingMs: 0 };
  const frames: PerfEntry[] = [];
  const jank = new Map<string, ScreenJank>();
  const slowEvents: PerfEntry[] = [];
  const settle = new Map<string, number[]>();
  const stretches = new Map<string, { audio: number; wall: number; rtf: number[] }>();
  const defers: Record<string, number> = {};
  const counters = new Map<string, { calls: number; ms: number; max: number; windowMs: number }>();
  const spans = new Map<string, number[]>();
  let recordings = 0;
  let recordedMs = 0;
  let blockedRecording = 0;
  let blockedOther = 0;
  let recordingMs = 0;
  let otherMs = 0;
  let minutes = 0;
  const nativeCores = { recording: [] as number[], other: [] as number[] };
  const memory: {
    heapMbMax?: number;
    heapMbLast?: number;
    nativePssMbMax?: number;
    availMbMin?: number;
    tempCMax?: number;
    thermalMax?: number;
  } = {};
  const max = (key: keyof typeof memory, value: number | undefined): void => {
    if (value === undefined) return;
    memory[key] = Math.max(memory[key] ?? Number.NEGATIVE_INFINITY, value);
  };

  for (const session of file.sessions) {
    // Frames the browser had buffered before the switch was turned on come with t < 0.
    const firstAt = session.entries.reduce((low, entry) => Math.min(low, entry.t), 0);
    const spanMs = session.durationMs - firstAt;
    minutes += spanMs / 60_000;
    const recordingRanges = spanRanges(session.entries, RECORDING_FEATURE);
    // A recording still running when the log was shared has no span yet: from its start mark on.
    const openStarts = session.entries.filter(
      (entry) => entry.k === 'mark' && entry.n === 'recorder.start',
    );
    for (const start of openStarts) {
      if (!recordingRanges.some(([from]) => Math.abs(from - start.t) < 2_000)) {
        recordingRanges.push([start.t, session.durationMs]);
      }
    }
    const sessionRecordingMs = recordingRanges.reduce((sum, [from, to]) => sum + (to - from), 0);
    recordingMs += sessionRecordingMs;
    otherMs += Math.max(0, spanMs - sessionRecordingMs);
    recordings += recordingRanges.length;
    recordedMs += sessionRecordingMs;

    for (const entry of session.entries) {
      if (isLongFrame(entry)) {
        total.count += 1;
        total.ms += entry.d ?? 0;
        total.blockingMs += blocking(entry);
        add(byScreen, entry.s ?? '?', entry);
        const features = entry.a && entry.a.length > 0 ? entry.a : ['(ничего не шло)'];
        for (const feature of features) add(byFeature, feature, entry);
        add(byScript, scriptKey(entry.x?.[0]), entry);
        frames.push(entry);
        if (inRanges(entry.t, recordingRanges)) blockedRecording += blocking(entry);
        else blockedOther += blocking(entry);
      } else if (entry.k === 'jank') {
        const key = entry.s ?? '?';
        const row = jank.get(key) ?? {
          screen: key,
          frames: 0,
          dropped: 0,
          over50: 0,
          worst: 0,
          sampledMs: 0,
        };
        row.frames += num(entry, 'frames') ?? 0;
        row.dropped += num(entry, 'dropped') ?? 0;
        row.over50 += num(entry, 'over50') ?? 0;
        row.worst = Math.max(row.worst, num(entry, 'worst') ?? 0);
        row.sampledMs += entry.d ?? 0;
        jank.set(key, row);
      } else if (entry.k === 'event') {
        slowEvents.push(entry);
      } else if (entry.k === 'settle') {
        const list = settle.get(entry.s ?? '?') ?? [];
        list.push(entry.d ?? 0);
        settle.set(entry.s ?? '?', list);
      } else if (entry.k === 'span') {
        if (entry.n === 'asr.stretch') {
          const engine = typeof entry.f?.['engine'] === 'string' ? entry.f['engine'] : '?';
          const row = stretches.get(engine) ?? { audio: 0, wall: 0, rtf: [] };
          const audio = num(entry, 'audioS') ?? 0;
          row.audio += audio;
          row.wall += entry.d ?? 0;
          if (audio > 0) row.rtf.push((entry.d ?? 0) / 1000 / audio);
          stretches.set(engine, row);
        }
        if (entry.n !== RECORDING_FEATURE) {
          const list = spans.get(entry.n) ?? [];
          list.push(entry.d ?? 0);
          spans.set(entry.n, list);
        }
      } else if (entry.k === 'mark' && entry.n === 'asr.defer') {
        const reason = typeof entry.f?.['reason'] === 'string' ? entry.f['reason'] : '?';
        defers[reason] = (defers[reason] ?? 0) + 1;
      } else if (entry.k === 'count') {
        const row = counters.get(entry.n) ?? { calls: 0, ms: 0, max: 0, windowMs: 0 };
        row.calls += num(entry, 'calls') ?? 0;
        row.ms += num(entry, 'ms') ?? 0;
        row.max = Math.max(row.max, num(entry, 'max') ?? 0);
        row.windowMs += entry.d ?? 0;
        counters.set(entry.n, row);
      } else if (entry.k === 'mem') {
        max('heapMbMax', num(entry, 'usedMb'));
        const used = num(entry, 'usedMb');
        if (used !== undefined) memory.heapMbLast = used;
      } else if (entry.k === 'native') {
        max('nativePssMbMax', num(entry, 'pssMb'));
        max('tempCMax', num(entry, 'tempC'));
        max('thermalMax', num(entry, 'thermal'));
        const avail = num(entry, 'availMb');
        if (avail !== undefined) memory.availMbMin = Math.min(memory.availMbMin ?? avail, avail);
        const cores = num(entry, 'cpuCores');
        if (cores !== undefined) {
          (inRanges(entry.t, recordingRanges) ? nativeCores.recording : nativeCores.other).push(
            cores,
          );
        }
      }
    }
  }

  const last = file.sessions.at(-1);
  const device = last?.device ?? {};
  const native = device['native'] as Readonly<Record<string, unknown>> | undefined;
  const deviceName = native
    ? `${String(native['manufacturer'] ?? '')} ${String(native['model'] ?? '')}, Android ${String(native['release'] ?? '')}`.trim()
    : String(device['userAgent'] ?? '').slice(0, 120);
  const mean = (values: readonly number[]): number | undefined =>
    values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0) / values.length;
  const coresRecording = mean(nativeCores.recording);
  const coresOther = mean(nativeCores.other);
  return {
    sessions: file.sessions.length,
    minutes,
    version: last?.version ?? '?',
    device: deviceName,
    longFrames: total,
    longFramesByScreen: sortedTallies(byScreen, 12),
    longFramesByFeature: sortedTallies(byFeature, 12),
    longFramesByScript: sortedTallies(byScript, 15),
    worstFrames: frames.sort((left, right) => blocking(right) - blocking(left)).slice(0, 10),
    jank: [...jank.values()].sort((left, right) => right.dropped - left.dropped),
    slowEvents: slowEvents.sort((left, right) => (right.d ?? 0) - (left.d ?? 0)).slice(0, 12),
    settle: [...settle]
      .map(([screen, values]) => ({
        screen,
        count: values.length,
        medianMs: quantile(values, 0.5),
        maxMs: Math.max(...values),
      }))
      .sort((left, right) => right.medianMs - left.medianMs),
    recorder: {
      recordings,
      recordedMinutes: recordedMs / 60_000,
      engines: [...stretches].map(([engine, row]) => ({
        engine,
        stretches: row.rtf.length,
        audioSeconds: row.audio,
        wallMs: row.wall,
        rtfMedian: quantile(row.rtf, 0.5),
        rtfP90: quantile(row.rtf, 0.9),
        rtfMax: row.rtf.length > 0 ? Math.max(...row.rtf) : 0,
      })),
      defers,
      blockedMsPerMinRecording: recordingMs > 0 ? blockedRecording / (recordingMs / 60_000) : 0,
      blockedMsPerMinOther: otherMs > 0 ? blockedOther / (otherMs / 60_000) : 0,
      counters: [...counters]
        .filter(([name]) => name !== 'perflog.tick')
        .map(([name, row]) => ({
          name,
          calls: row.calls,
          callsPerSecond: row.windowMs > 0 ? row.calls / (row.windowMs / 1000) : 0,
          msPerSecond: row.windowMs > 0 ? row.ms / (row.windowMs / 1000) : 0,
          max: row.max,
        }))
        .sort((left, right) => right.msPerSecond - left.msPerSecond),
      ...(coresRecording === undefined ? {} : { nativeCoresRecording: coresRecording }),
      ...(coresOther === undefined ? {} : { nativeCoresOther: coresOther }),
    },
    spans: [...spans]
      .map(([name, values]) => ({
        name,
        count: values.length,
        medianMs: quantile(values, 0.5),
        p90Ms: quantile(values, 0.9),
        maxMs: Math.max(...values),
      }))
      .sort((left, right) => right.p90Ms * right.count - left.p90Ms * left.count),
    memory,
  };
}

const round = (value: number): string => String(Math.round(value));
const minutesText = (value: number): string =>
  value < 10 ? value.toFixed(1).replace('.', ',') : round(value);

/** Russian one/few/many form: plural(3, 'отрезок', 'отрезка', 'отрезков'). */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** A few Russian lines for the top of the shared file and the toast. */
export function perfLogSummary(analysis: PerfAnalysis): string[] {
  const frames = analysis.longFrames.count;
  const sessions = analysis.sessions;
  const lines = [
    `MiniMed ${analysis.version}, ${analysis.device || 'устройство не определено'}.`,
    `Записано ${minutesText(analysis.minutes)} мин (${String(sessions)} ${plural(sessions, 'сеанс', 'сеанса', 'сеансов')}), ${String(frames)} ${plural(frames, 'долгий кадр', 'долгих кадра', 'долгих кадров')}, блокировка ${(analysis.longFrames.blockingMs / 1000).toFixed(1).replace('.', ',')} с.`,
  ];
  const screen = analysis.longFramesByScreen[0];
  if (screen) {
    lines.push(
      `Больше всего тормозит экран ${screen.key}: ${String(screen.count)} ${plural(screen.count, 'долгий кадр', 'долгих кадра', 'долгих кадров')}, ${round(screen.blockingMs)} мс блокировки.`,
    );
  }
  const script = analysis.longFramesByScript[0];
  if (script) lines.push(`Главный виновник: ${script.key} (${round(script.blockingMs)} мс).`);
  const recorder = analysis.recorder;
  if (recorder.recordings > 0) {
    lines.push(
      `Запись беседы: ${String(recorder.recordings)} ${plural(recorder.recordings, 'запись', 'записи', 'записей')}, ${minutesText(recorder.recordedMinutes)} мин; блокировка ${round(recorder.blockedMsPerMinRecording)} мс в минуту при записи и ${round(recorder.blockedMsPerMinOther)} без неё.`,
    );
    for (const engine of recorder.engines) {
      lines.push(
        `Расшифровка ${engine.engine}: ${String(engine.stretches)} ${plural(engine.stretches, 'отрезок', 'отрезка', 'отрезков')}, RTF медиана ${engine.rtfMedian.toFixed(2)}, p90 ${engine.rtfP90.toFixed(2)}.`,
      );
    }
  }
  const worstJank = analysis.jank[0];
  if (worstJank && worstJank.dropped > 0) {
    const share = worstJank.dropped / Math.max(1, worstJank.frames + worstJank.dropped);
    lines.push(
      `Пропущенные кадры: ${worstJank.screen} — ${String(Math.round(share * 100))} % при касаниях и прокрутке.`,
    );
  }
  return lines;
}
