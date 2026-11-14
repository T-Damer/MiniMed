import { describe, expect, it } from 'vitest';

import { renderPerfReport } from '../../../../scripts/perf-log-report';
import type { PerfEntry } from './perf-log';
import {
  analysePerfLog,
  chunkName,
  PERF_LOG_FORMAT,
  type PerfLogFile,
  perfLogSummary,
} from './perf-log-analysis';

/** A synthetic log: two minutes on the search home, one of them recording. No real data. */
function syntheticLog(): PerfLogFile {
  const entries: PerfEntry[] = [
    { t: 1_000, k: 'route', n: 'enter', s: 'search' },
    { t: 1_000, k: 'settle', n: 'screen', s: 'search', d: 640, f: { firstFrame: 30 } },
    { t: 10_000, k: 'mark', n: 'recorder.start', s: 'search' },
    {
      t: 20_000,
      k: 'frame',
      n: 'loaf',
      s: 'search',
      a: ['recorder.recording'],
      d: 180,
      f: { blocking: 130, render: 20 },
      x: [
        {
          d: 150,
          u: 'ConversationRecorder-Bx12abCd.js',
          fn: 'Qe',
          it: 'event-listener',
          i: 'MessagePort.onmessage',
        },
      ],
    },
    {
      t: 30_000,
      k: 'span',
      n: 'asr.stretch',
      s: 'search',
      a: ['recorder.recording'],
      d: 900,
      f: { engine: 'native', audioS: 9, ok: true },
    },
    {
      t: 41_000,
      k: 'span',
      n: 'asr.stretch',
      s: 'search',
      d: 1_100,
      f: { engine: 'native', audioS: 10 },
    },
    {
      t: 45_000,
      k: 'count',
      n: 'waveform.draw',
      s: 'search',
      d: 15_000,
      f: { calls: 300, ms: 150, max: 4 },
    },
    {
      t: 45_000,
      k: 'native',
      n: 'sample',
      s: 'search',
      f: { cpuCores: 0.8, tempC: 38.5, thermal: 1 },
    },
    { t: 10_000, k: 'span', n: 'recorder.recording', s: 'search', d: 60_000, f: { recordedS: 60 } },
    { t: 90_000, k: 'frame', n: 'loaf', s: 'notes', d: 70, x: [{ d: 60, u: 'index-AbCdEf12.js' }] },
    { t: 95_000, k: 'native', n: 'sample', s: 'notes', f: { cpuCores: 0.1, tempC: 36 } },
    {
      t: 100_000,
      k: 'jank',
      n: 'frames',
      s: 'notes',
      d: 1_500,
      f: { frames: 170, dropped: 10, over50: 1, worst: 70 },
    },
    {
      t: 101_000,
      k: 'event',
      n: 'pointerdown',
      s: 'notes',
      d: 240,
      el: 'button.recorder-pill__stop',
      f: { delay: 120, handlers: 80, paint: 40 },
    },
    { t: 110_000, k: 'mark', n: 'asr.defer', s: 'notes', f: { reason: 'slow' } },
  ];
  return {
    format: PERF_LOG_FORMAT,
    formatVersion: 1,
    exportedAt: '2026-11-14T12:00:00.000Z',
    summary: [],
    sessions: [
      {
        id: 's1',
        startedAt: '2026-11-14T11:58:00.000Z',
        version: '0.6.99',
        device: {
          userAgent: 'test',
          native: { manufacturer: 'Test', model: 'Phone', release: '15' },
        },
        durationMs: 120_000,
        droppedEntries: 0,
        vsyncMs: 8.33,
        entries,
      },
    ],
  };
}

describe('analysePerfLog', () => {
  it('blames long frames on screens, features and scripts', () => {
    const analysis = analysePerfLog(syntheticLog());
    expect(analysis.longFrames).toEqual({ count: 2, ms: 250, blockingMs: 150 });
    expect(analysis.longFramesByScreen[0]).toMatchObject({
      key: 'search',
      count: 1,
      blockingMs: 130,
    });
    expect(analysis.longFramesByFeature.map((row) => row.key)).toEqual([
      'recorder.recording',
      '(ничего не шло)',
    ]);
    expect(analysis.longFramesByScript[0]?.key).toBe(
      'ConversationRecorder Qe ← event-listener MessagePort.onmessage',
    );
  });

  it('reads the recorder: recording time, engines, deferrals, counters, CPU', () => {
    const { recorder } = analysePerfLog(syntheticLog());
    expect(recorder.recordings).toBe(1);
    expect(recorder.recordedMinutes).toBe(1);
    expect(recorder.engines).toEqual([
      expect.objectContaining({ engine: 'native', stretches: 2, audioSeconds: 19, rtfMedian: 0.1 }),
    ]);
    expect(recorder.defers).toEqual({ slow: 1 });
    expect(recorder.blockedMsPerMinRecording).toBe(130);
    expect(recorder.blockedMsPerMinOther).toBe(20);
    expect(recorder.counters[0]).toMatchObject({
      callsPerSecond: 20,
      name: 'waveform.draw',
      calls: 300,
      msPerSecond: 10,
    });
    expect(recorder.nativeCoresRecording).toBe(0.8);
    expect(recorder.nativeCoresOther).toBe(0.1);
  });

  it('summarises in Russian and renders a Markdown report', () => {
    const file = syntheticLog();
    const analysis = analysePerfLog(file);
    const summary = perfLogSummary(analysis);
    expect(summary[0]).toBe('MiniMed 0.6.99, Test Phone, Android 15.');
    expect(summary.join('\n')).toContain('Расшифровка native: 2 отрезка');
    const report = renderPerfReport(file, analysis);
    expect(report).toContain('## Conversation recorder');
    expect(report).toContain('| notes | 170 | 10 | 6 % | 1 | 70 ms | 1.5 s |');
    expect(report).toContain('button.recorder-pill__stop');
  });

  it('strips the build hash from chunk names', () => {
    expect(chunkName('ConversationRecorder-Bx12abCd.js')).toBe('ConversationRecorder');
    expect(chunkName('index.js')).toBe('index');
    expect(chunkName(undefined)).toBe('(без файла)');
  });
});
