import { afterEach, describe, expect, it, vi } from 'vitest';

const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => stored.set(key, value),
  removeItem: (key: string) => stored.delete(key),
  clear: () => stored.clear(),
});
vi.stubGlobal('window', new EventTarget());

vi.mock('./perf-log-collector', () => ({
  startPerfCollector: vi.fn(),
  stopPerfCollector: vi.fn(async () => undefined),
}));

import {
  attachPerfSink,
  codeLabel,
  elementLabel,
  PERF_LOG_AUTO_OFF_MS,
  PERF_LOG_KEY,
  type PerfEntry,
  perfCount,
  perfFeatures,
  perfFlagFromAddress,
  perfLogOn,
  perfLogOnSince,
  perfMark,
  perfSpan,
  safeFields,
  setPerfLogEnabled,
  takePerfCounters,
} from './perf-log';
import { screenOf } from './perf-log-screen';

afterEach(async () => {
  await setPerfLogEnabled(false);
  attachPerfSink(undefined);
  localStorage.clear();
});

describe('safeFields', () => {
  it('keeps numbers, booleans and enum-like words; drops free text', () => {
    expect(
      safeFields({
        engine: 'native',
        audioS: 9.437,
        ok: true,
        query: 'боли в груди',
        name: 'Иванов Иван',
        mixed: 'Whisper Base',
        'bad key': 1,
      }),
    ).toEqual({ engine: 'native', audioS: 9.4, ok: true, dropped: 4 });
  });

  it('drops non-finite numbers', () => {
    expect(safeFields({ rtf: Number.NaN, ms: Number.POSITIVE_INFINITY })).toBeUndefined();
  });
});

describe('labels from the code', () => {
  it('keeps only the file name of a URL', () => {
    expect(codeLabel('https://localhost/assets/Recorder-Bx12.js?q=пневмония#x')).toBe(
      'Recorder-Bx12.js',
    );
    expect(codeLabel('BUTTON#save.onclick')).toBe('BUTTON#save.onclick');
    expect(codeLabel('текст пациента')).toBe('_');
  });

  it('names an element by its tag and BEM classes, never its text', () => {
    const button = {
      tagName: 'BUTTON',
      classList: ['recorder-pill__stop', 'ui-button', 'Mixed'],
      textContent: 'Иванов',
      id: 'patient-42',
    };
    expect(elementLabel(button)).toBe('button.recorder-pill__stop.ui-button');
    expect(elementLabel(null)).toBeUndefined();
  });
});

describe('screenOf', () => {
  it('keeps route words and hides ids and queries', () => {
    expect(screenOf('#/search?q=боли%20в%20груди')).toBe('search');
    expect(screenOf('#/notes/patients/7f3c9a10-2b4e')).toBe('notes/patients/:id');
    expect(screenOf('#/modules/documents/d/a2xpbmljYWwvODE0XzE')).toBe('modules/documents/d/:id');
    expect(screenOf('#/modules/documents/user/Иванов-выписка.pdf')).toBe(
      'modules/documents/user/:id',
    );
    expect(screenOf('')).toBe('home');
    expect(screenOf('#/')).toBe('home');
  });
});

describe('address flag', () => {
  it('reads ?perf=1 and ?perf=0 before or inside the hash', () => {
    expect(perfFlagFromAddress('https://localhost/?perf=1#/search')).toBe(true);
    expect(perfFlagFromAddress('https://localhost/#/settings?perf=0')).toBe(false);
    expect(perfFlagFromAddress('https://localhost/#/search?q=perf=1x')).toBeUndefined();
    expect(perfFlagFromAddress('https://localhost/#/search')).toBeUndefined();
  });
});

describe('auto-off', () => {
  it('turns itself off two days after it was turned on', () => {
    const since = Date.UTC(2026, 10, 14);
    localStorage.setItem(PERF_LOG_KEY, String(since));
    expect(perfLogOnSince(since + 1_000)).toBe(since);
    expect(perfLogOnSince(since + PERF_LOG_AUTO_OFF_MS + 1)).toBeUndefined();
    expect(localStorage.getItem(PERF_LOG_KEY)).toBeNull();
  });
});

describe('off', () => {
  it('records nothing and costs one check per call', () => {
    const seen: PerfEntry[] = [];
    attachPerfSink((entry) => seen.push(entry));
    expect(perfLogOn()).toBe(false);
    const started = performance.now();
    for (let index = 0; index < 1_000_000; index += 1) {
      perfMark('recorder.tap');
      perfCount('waveform.draw', 1);
      perfSpan('asr.stretch')();
    }
    const elapsed = performance.now() - started;
    expect(seen).toEqual([]);
    expect(takePerfCounters()).toEqual([]);
    // Three million calls; a slow CI machine still stays far under this.
    expect(elapsed).toBeLessThan(1_000);
  });
});

describe('on', () => {
  it('records marks, spans with running features, and summed counters', async () => {
    const seen: PerfEntry[] = [];
    await setPerfLogEnabled(true);
    attachPerfSink((entry) => seen.push(entry));
    const end = perfSpan('recorder.recording');
    expect(perfFeatures()).toEqual(['recorder.recording']);
    perfMark('asr.defer', { reason: 'slow', text: 'Расскажите, как вы спите' });
    perfCount('waveform.draw', 2);
    perfCount('waveform.draw', 3);
    end({ recordedS: 61 });
    expect(perfFeatures()).toBeUndefined();
    expect(seen.map((entry) => [entry.k, entry.n])).toEqual([
      ['mark', 'asr.defer'],
      ['span', 'recorder.recording'],
    ]);
    expect(seen[0]?.f).toEqual({ reason: 'slow', dropped: 1 });
    expect(seen[1]?.f).toEqual({ recordedS: 61 });
    expect(takePerfCounters()).toEqual([{ name: 'waveform.draw', calls: 2, ms: 5, max: 3 }]);
  });

  it('refuses names that are not code names', async () => {
    const seen: PerfEntry[] = [];
    await setPerfLogEnabled(true);
    attachPerfSink((entry) => seen.push(entry));
    perfMark('Иванов');
    perfMark('search query');
    expect(seen).toEqual([]);
  });
});
