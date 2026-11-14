#!/usr/bin/env bun
/**
 * Turns a MiniMed performance log (Settings → «Основные» → «Журнал производительности» →
 * «Поделиться журналом», PERFLOG1) into a readable Markdown report: where the app blocked, on which
 * screen, during which feature and in which script; dropped frames per screen; slow taps; how long
 * screens took to settle; the conversation recorder and transcription; memory and heat.
 *
 *   bun scripts/perf-log-report.ts minimed-perf-0.6.99-20261114-1030.json [--out report.md]
 *
 * The log holds timings, counts and fixed names only (no text, queries or patient data).
 */
import { readFileSync, writeFileSync } from 'node:fs';

import {
  analysePerfLog,
  blocking,
  PERF_LOG_FORMAT,
  type PerfAnalysis,
  type PerfLogFile,
  perfLogSummary,
  scriptKey,
} from '../apps/app/src/state/perf-log-analysis';

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

export function readPerfLog(path: string): PerfLogFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    fail(`Not a JSON file: ${path} (${String(cause)})`);
  }
  const file = parsed as Partial<PerfLogFile>;
  if (file.format !== PERF_LOG_FORMAT || !Array.isArray(file.sessions)) {
    fail(`Not a MiniMed performance log: ${path}`);
  }
  return file as PerfLogFile;
}

const ms = (value: number): string => `${Math.round(value).toLocaleString('en-US')} ms`;
const fixed = (value: number, digits = 2): string => value.toFixed(digits);
const cell = (value: string): string => value.replace(/\|/gu, '\\|');

function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return '_none_\n';
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
}

export function renderPerfReport(
  file: PerfLogFile,
  analysis: PerfAnalysis = analysePerfLog(file),
): string {
  const out: string[] = [];
  const first = file.sessions[0];
  const device = file.sessions.at(-1)?.device ?? {};
  out.push(`# MiniMed performance log — ${analysis.version}`);
  out.push('');
  out.push(`- Device: ${analysis.device || 'unknown'}`);
  out.push(`- User agent: \`${String(device['userAgent'] ?? '?')}\``);
  out.push(
    `- Recorded: ${fixed(analysis.minutes, 1)} min in ${String(analysis.sessions)} session(s), from ${first?.startedAt ?? '?'}; exported ${file.exportedAt}`,
  );
  const vsync = file.sessions.at(-1)?.vsyncMs;
  if (vsync)
    out.push(
      `- Frame interval seen: ${fixed(vsync)} ms (≈ ${String(Math.round(1000 / vsync))} Hz)`,
    );
  const lost = file.sessions.reduce((sum, session) => sum + session.droppedEntries, 0);
  if (lost > 0) out.push(`- Oldest ${String(lost)} entries were pushed out of the ring buffer.`);
  out.push(
    `- Long frames: ${String(analysis.longFrames.count)}, ${ms(analysis.longFrames.ms)} in total, ${ms(analysis.longFrames.blockingMs)} blocking (time past 50 ms per frame)`,
  );
  out.push('');
  out.push('## Summary (as shown in the app)');
  out.push('');
  for (const line of perfLogSummary(analysis)) out.push(`- ${line}`);
  out.push('');

  out.push('## Long frames by screen');
  out.push('');
  out.push(
    table(
      ['screen', 'frames', 'total', 'blocking'],
      analysis.longFramesByScreen.map((row) => [
        row.key,
        String(row.count),
        ms(row.ms),
        ms(row.blockingMs),
      ]),
    ),
  );
  out.push('');
  out.push('## Long frames by running feature');
  out.push('');
  out.push(
    table(
      ['feature', 'frames', 'total', 'blocking'],
      analysis.longFramesByFeature.map((row) => [
        row.key,
        String(row.count),
        ms(row.ms),
        ms(row.blockingMs),
      ]),
    ),
  );
  out.push('');
  out.push('## Long frames by script (longest script of each frame)');
  out.push('');
  out.push(
    table(
      ['chunk, function ← invoker', 'frames', 'total', 'blocking'],
      analysis.longFramesByScript.map((row) => [
        row.key,
        String(row.count),
        ms(row.ms),
        ms(row.blockingMs),
      ]),
    ),
  );
  out.push('');
  out.push('## Worst frames');
  out.push('');
  out.push(
    table(
      ['at (s)', 'screen', 'duration', 'blocking', 'render', 'features', 'scripts'],
      analysis.worstFrames.map((entry) => [
        fixed(entry.t / 1000, 1),
        entry.s ?? '?',
        ms(entry.d ?? 0),
        ms(blocking(entry)),
        ms(Number(entry.f?.['render'] ?? 0)),
        (entry.a ?? []).join(', ') || '—',
        (entry.x ?? [])
          .map(
            (script) =>
              `${scriptKey(script)} ${String(script.d)} ms${script.fl ? ` (layout ${String(script.fl)})` : ''}${script.p !== undefined ? ` @${String(script.p)}` : ''}`,
          )
          .join('; ') || '—',
      ]),
    ),
  );
  out.push('');

  out.push('## Dropped frames while touching or scrolling');
  out.push('');
  out.push(
    table(
      [
        'screen',
        'frames',
        'missed refreshes',
        'missed share',
        'frames > 50 ms',
        'worst',
        'sampled',
      ],
      analysis.jank.map((row) => [
        row.screen,
        String(row.frames),
        String(row.dropped),
        `${String(Math.round((row.dropped / Math.max(1, row.frames + row.dropped)) * 100))} %`,
        String(row.over50),
        ms(row.worst),
        `${fixed(row.sampledMs / 1000, 1)} s`,
      ]),
    ),
  );
  out.push('');
  out.push('## Slow interactions (≥ 100 ms from input to paint)');
  out.push('');
  out.push(
    table(
      [
        'at (s)',
        'event',
        'element',
        'screen',
        'total',
        'input delay',
        'handlers',
        'to paint',
        'features',
      ],
      analysis.slowEvents.map((entry) => [
        fixed(entry.t / 1000, 1),
        entry.n,
        entry.el ?? '?',
        entry.s ?? '?',
        ms(entry.d ?? 0),
        ms(Number(entry.f?.['delay'] ?? 0)),
        ms(Number(entry.f?.['handlers'] ?? 0)),
        ms(Number(entry.f?.['paint'] ?? 0)),
        (entry.a ?? []).join(', ') || '—',
      ]),
    ),
  );
  out.push('');
  out.push('## Screen settle time (until the DOM stays still for 0.5 s)');
  out.push('');
  out.push(
    table(
      ['screen', 'visits', 'median', 'max'],
      analysis.settle.map((row) => [
        row.screen,
        String(row.count),
        ms(row.medianMs),
        ms(row.maxMs),
      ]),
    ),
  );
  out.push('');

  const recorder = analysis.recorder;
  out.push('## Conversation recorder');
  out.push('');
  out.push(
    `- Recordings: ${String(recorder.recordings)}, ${fixed(recorder.recordedMinutes, 1)} min`,
  );
  out.push(
    `- Blocking per minute: ${ms(recorder.blockedMsPerMinRecording)} while recording, ${ms(recorder.blockedMsPerMinOther)} otherwise`,
  );
  if (recorder.nativeCoresRecording !== undefined || recorder.nativeCoresOther !== undefined) {
    out.push(
      `- App process CPU (native sampler; the WebView renderer is not included): ${fixed(recorder.nativeCoresRecording ?? 0)} cores while recording, ${fixed(recorder.nativeCoresOther ?? 0)} otherwise`,
    );
  }
  const defers = Object.entries(recorder.defers);
  out.push(
    `- Live text deferred: ${defers.length === 0 ? 'never' : defers.map(([reason, count]) => `${reason} × ${String(count)}`).join(', ')}`,
  );
  out.push('');
  out.push(
    table(
      ['engine', 'stretches', 'audio', 'wall', 'RTF median', 'RTF p90', 'RTF max'],
      recorder.engines.map((row) => [
        row.engine,
        String(row.stretches),
        `${fixed(row.audioSeconds, 0)} s`,
        ms(row.wallMs),
        fixed(row.rtfMedian),
        fixed(row.rtfP90),
        fixed(row.rtfMax),
      ]),
    ),
  );
  out.push('');
  out.push('Frequent steps (summed per 15 s tick):');
  out.push('');
  out.push(
    table(
      ['counter', 'calls', 'calls per second', 'ms per second', 'slowest call'],
      recorder.counters.map((row) => [
        row.name,
        String(row.calls),
        fixed(row.callsPerSecond, 1),
        fixed(row.msPerSecond),
        ms(row.max),
      ]),
    ),
  );
  out.push('');

  out.push('## Timed steps');
  out.push('');
  out.push(
    table(
      ['span', 'count', 'median', 'p90', 'max'],
      analysis.spans.map((row) => [
        row.name,
        String(row.count),
        ms(row.medianMs),
        ms(row.p90Ms),
        ms(row.maxMs),
      ]),
    ),
  );
  out.push('');
  out.push('## Memory and heat');
  out.push('');
  const memory = analysis.memory;
  const line = (label: string, value: number | undefined, unit: string): void => {
    if (value !== undefined) out.push(`- ${label}: ${fixed(value, 1)} ${unit}`);
  };
  line('JS heap, max', memory.heapMbMax, 'MB');
  line('JS heap, last', memory.heapMbLast, 'MB');
  line('App process PSS, max', memory.nativePssMbMax, 'MB');
  line('Free device memory, min', memory.availMbMin, 'MB');
  line('Battery temperature, max', memory.tempCMax, '°C');
  line('Thermal status, max (0 none … 6 shutdown)', memory.thermalMax, '');
  out.push('');
  return `${out.join('\n')}\n`;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const outPath = outIndex >= 0 ? args[outIndex + 1] : undefined;
  const valueIndex = outIndex >= 0 ? outIndex + 1 : -1;
  const input = args.find((arg, index) => !arg.startsWith('--') && index !== valueIndex);
  if (!input) fail('Usage: bun scripts/perf-log-report.ts <minimed-perf-….json> [--out report.md]');
  const report = renderPerfReport(readPerfLog(input));
  if (outPath) writeFileSync(outPath, report);
  else process.stdout.write(report);
}
