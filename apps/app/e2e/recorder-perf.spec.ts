import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type CDPSession, chromium, expect, type Page, test } from '@playwright/test';
import { installFakeSpeech } from './fake-speech';
import { E2E_ASSET_ORIGIN } from './mount-built-app';

/**
 * REC1 (owner 2026-11-13 «приложение сильно лагало во время записи»): what the app costs while a
 * conversation is being recorded and the doctor uses another screen. Not a gate; run with
 * `PERF_REC=1`. The microphone is Chromium's fake device fed by a synthetic WAV (`PERF_REC_WAV`,
 * e.g. macOS `say -v Milena` → 48 kHz mono s16); without it, the fake device's beep. The speech
 * worker is the e2e stand-in (`fake-speech.ts`): it answers at once, so what is measured is the
 * recorder's own work around recognition — decoding, resampling, drawing, saving.
 *
 *   PERF_REC=1 PERF_REC_WAV=/path/dialog.wav E2E_PORT=4291 bunx playwright test recorder-perf --workers=1
 *
 * Windows of `PERF_REC_WINDOW_MS` (10 s) are taken at the recording ages in `PERF_REC_AT`
 * (seconds, default 30,90,180), on the search home with the recorder collapsed, after the app has
 * settled for `PERF_REC_SETTLE_MS`. `recognitions` counts the stretches sent to the speech worker.
 *
 * `PERF_REC_DECODE=a.webm,b.webm` also times, in the page, what the recorder before REC1 did every
 * 7 s of a recording: decode the whole file so far into a 16 kHz OfflineAudioContext and resample
 * it again (`decodeToPcm16k`), for files of known length.
 */
const PROFILE_DIR = resolve(import.meta.dirname, '../../../playwright/recorder-perf-profile');
const OUT =
  process.env['PERF_REC_OUT'] ?? resolve(import.meta.dirname, '../../../output/recorder-perf.json');
const WINDOW_MS = Number(process.env['PERF_REC_WINDOW_MS'] ?? '10000');
const AGES = (process.env['PERF_REC_AT'] ?? '30,90,180').split(',').map(Number);
const SETTLE_MS = Number(process.env['PERF_REC_SETTLE_MS'] ?? '20000');
/** Synthetic opus files (comma-separated) for the decode micro-benchmark, e.g. 1/10/30 min. */
const DECODE_FILES = (process.env['PERF_REC_DECODE'] ?? '').split(',').filter(Boolean);

function parseCpuTime(value: string): number {
  const [days, rest] = value.includes('-') ? value.split('-') : ['0', value];
  let seconds = 0;
  for (const part of (rest ?? '').split(':').map(Number)) seconds = seconds * 60 + part;
  return (Number(days) * 86_400 + seconds) * 1000;
}

/** CPU ms so far of every process of the browser that owns the profile, by process type. */
function processTimes(): Record<string, number> {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,time=,command='], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/u))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      ms: parseCpuTime(match[3] ?? '0'),
      command: match[4] ?? '',
    }));
  const root = rows.find(
    (row) =>
      row.command.includes(`--user-data-dir=${PROFILE_DIR}`) && !row.command.includes('--type='),
  );
  if (!root) return {};
  const family = new Set([root.pid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const row of rows) {
      if (!family.has(row.pid) && family.has(row.ppid)) {
        family.add(row.pid);
        grew = true;
      }
    }
  }
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (!family.has(row.pid)) continue;
    const type = row.command.match(/--type=(\S+)/u)?.[1] ?? 'browser';
    out[type] = (out[type] ?? 0) + row.ms;
  }
  return out;
}

async function mainThread(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics } = (await cdp.send('Performance.getMetrics')) as {
    metrics: { name: string; value: number }[];
  };
  const pick = (name: string): number => metrics.find((m) => m.name === name)?.value ?? 0;
  return {
    task: pick('TaskDuration') * 1000,
    script: pick('ScriptDuration') * 1000,
    style: pick('RecalcStyleCount'),
    layout: pick('LayoutCount'),
    heap: pick('JSHeapUsedSize'),
  };
}

/** In the page: long tasks and animation-frame gaps since the last call. */
function installFrameProbe(): void {
  const probe = { longTasks: [] as number[], gaps: [] as number[], last: 0 };
  (window as unknown as { __rec: typeof probe }).__rec = probe;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) probe.longTasks.push(entry.duration);
  }).observe({ type: 'longtask', buffered: false });
  const frame = (now: number): void => {
    if (probe.last > 0) probe.gaps.push(now - probe.last);
    probe.last = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

async function takeFrames(page: Page) {
  return page.evaluate(() => {
    const probe = (window as unknown as { __rec: { longTasks: number[]; gaps: number[] } }).__rec;
    const longTasks = probe.longTasks.splice(0);
    const gaps = probe.gaps.splice(0);
    return {
      longTasks: longTasks.length,
      longTaskMs: Math.round(longTasks.reduce((sum, value) => sum + value, 0)),
      longestTaskMs: Math.round(Math.max(0, ...longTasks)),
      frames: gaps.length,
      jankFrames: gaps.filter((gap) => gap > 50).length,
      worstGapMs: Math.round(Math.max(0, ...gaps)),
    };
  });
}

test('cost of a running recording on another screen', async () => {
  test.skip(process.env['PERF_REC'] !== '1', 'run with PERF_REC=1');
  test.setTimeout(20 * 60_000);
  mkdirSync(PROFILE_DIR, { recursive: true });
  const wav = process.env['PERF_REC_WAV'];
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2.75,
    hasTouch: true,
    isMobile: true,
    serviceWorkers: 'block',
    permissions: ['microphone'],
    ...(process.env['CHROMIUM_PATH'] ? { executablePath: process.env['CHROMIUM_PATH'] } : {}),
    args: [
      '--mute-audio',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      ...(wav ? [`--use-file-for-fake-audio-capture=${wav}`] : []),
    ],
  });
  await context.addInitScript(() => {
    window.localStorage.setItem('minimed:package-setup-dismissed:v1', '1');
    window.localStorage.setItem('minimed:core-download-consent:v1', '1');
  });
  const page = context.pages()[0] ?? (await context.newPage());
  if (process.env['PERF_REC_REAL_MODEL'] !== '1') await installFakeSpeech(page);
  await page.addInitScript(installFrameProbe);
  await page.addInitScript(() => {
    // Counts what the recorder hands to the speech worker (the stand-in or the real one).
    const counter = { recognitions: 0 };
    (window as unknown as { __speech: typeof counter }).__speech = counter;
    const Original = window.Worker;
    window.Worker = function countingWorker(url: string | URL, options?: WorkerOptions) {
      const worker = new Original(url, options);
      if (!String(url).includes('asr')) return worker;
      const post = worker.postMessage.bind(worker);
      worker.postMessage = ((message: { type?: string }, transfer?: Transferable[]) => {
        if (message?.type === 'transcribe') counter.recognitions += 1;
        post(message, transfer ?? []);
      }) as Worker['postMessage'];
      return worker;
    } as unknown as typeof Worker;
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(SETTLE_MS);

  await page.getByRole('button', { name: 'Все инструменты', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Все инструменты' });
  await sheet.locator('.quick-tool-row__open', { hasText: 'Запись беседы' }).click();
  const live = page.getByTestId('conversation-live');
  await live.getByRole('button', { name: 'Начать запись', exact: true }).click();
  await expect(live.getByRole('button', { name: /Стоп|Остановить/u }).first()).toBeVisible();
  const startedAt = Date.now();
  const download = live.locator('.asr-model-card').getByRole('button', { name: /Скачать/u });
  if (await download.isVisible().catch(() => false)) await download.click();
  await live
    .getByRole('button', { name: /Свернуть/u })
    .first()
    .click();
  await expect(live).toHaveCount(0);

  const rows: Record<string, unknown>[] = [];
  for (const age of AGES) {
    const wait = startedAt + age * 1000 - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    await takeFrames(page);
    const cpuBefore = processTimes();
    const mainBefore = await mainThread(cdp);
    const t0 = Date.now();
    await page.waitForTimeout(WINDOW_MS);
    const seconds = (Date.now() - t0) / 1000;
    const cpuAfter = processTimes();
    const mainAfter = await mainThread(cdp);
    const frames = await takeFrames(page);
    const cpu: Record<string, number> = {};
    for (const key of Object.keys(cpuAfter)) {
      cpu[key] = Math.round(((cpuAfter[key] ?? 0) - (cpuBefore[key] ?? 0)) / seconds);
    }
    cpu['total'] = Object.values(cpu).reduce((sum, value) => sum + value, 0);
    const row = {
      ageSeconds: age,
      cpuMsPerSecond: cpu,
      mainTaskMsPerSecond: Math.round(((mainAfter.task ?? 0) - (mainBefore.task ?? 0)) / seconds),
      scriptMsPerSecond: Math.round(((mainAfter.script ?? 0) - (mainBefore.script ?? 0)) / seconds),
      styleRecalcsPerSecond: Math.round(
        ((mainAfter.style ?? 0) - (mainBefore.style ?? 0)) / seconds,
      ),
      layoutsPerSecond: Math.round(((mainAfter.layout ?? 0) - (mainBefore.layout ?? 0)) / seconds),
      heapMb: Math.round((mainAfter.heap ?? 0) / 1_048_576),
      recognitions: await page.evaluate(
        () => (window as unknown as { __speech: { recognitions: number } }).__speech.recognitions,
      ),
      ...frames,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  const decode: Record<string, unknown>[] = [];
  for (const file of DECODE_FILES) {
    const name = file.split('/').pop() ?? file;
    await page.route(`**/__perf-audio/${name}`, (route) =>
      route.fulfill({ body: readFileSync(file), contentType: 'audio/webm' }),
    );
    const result = await page.evaluate(async (url) => {
      const bytes = await fetch(url).then((response) => response.arrayBuffer());
      const blob = new Blob([bytes], { type: 'audio/webm' });
      const before = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      const t0 = performance.now();
      // The recorder's step before REC1 (asr-models.ts decodeToPcm16k), verbatim.
      const decodeContext = new OfflineAudioContext(1, 1, 16_000);
      const decoded = await decodeContext.decodeAudioData(await blob.arrayBuffer());
      const t1 = performance.now();
      const frames = Math.max(1, Math.ceil(decoded.duration * 16_000));
      const resampler = new OfflineAudioContext(1, frames, 16_000);
      const source = resampler.createBufferSource();
      source.buffer = decoded;
      source.connect(resampler.destination);
      source.start();
      const rendered = await resampler.startRendering();
      const pcm = new Float32Array(rendered.getChannelData(0));
      const t2 = performance.now();
      return {
        seconds: Math.round(decoded.duration),
        decodeMs: Math.round(t1 - t0),
        resampleMs: Math.round(t2 - t1),
        totalMs: Math.round(t2 - t0),
        pcmMb: Math.round(pcm.byteLength / 1_048_576),
        heapBeforeMb: before ? Math.round(before.usedJSHeapSize / 1_048_576) : null,
      };
    }, `${E2E_ASSET_ORIGIN}/__perf-audio/${name}`);
    decode.push({ file: name, ...result });
    console.log(JSON.stringify({ decode: name, ...result }));
  }
  mkdirSync(resolve(OUT, '..'), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify({ windowMs: WINDOW_MS, rows, decode }, null, 2)}\n`);
  await context.close();
});
