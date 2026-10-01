/**
 * Side-by-side device measurement of the native app (benchmark build) and the WebView app on one
 * Android device or emulator: cold start, search latency over the doctor-lookup query set,
 * scrolling frame times on a result list, and memory.
 *
 *   bun scripts/device-app-bench.ts --serial emulator-5554 [--native org.med.spike.bench] [--web org.med.web] [--reps 3]
 *
 * Native queries go through the benchmark build's BENCH_QUERY broadcast and its logged
 * submit-to-painted-frame time; WebView queries through the WebView DevTools protocol (the app is a
 * debuggable build): the query is set on the search field, Enter is dispatched, and the time runs
 * to the first animation frame after the first result group exists. Both apps must already have
 * their core installed. Writes playwright/device-app-bench.json and prints a summary.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argument = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
};
const SERIAL = argument('serial', 'emulator-5554');
const NATIVE = argument('native', 'org.med.spike.bench');
const WEB = argument('web', 'org.med.web');
const REPS = Number(argument('reps', '3'));
const NATIVE_ACTIVITY = 'dev.localmed.nativespike.app.MainActivity';
const WEB_ACTIVITY = 'dev.localmed.search.MainActivity';
const SCROLL_QUERY = 'бронхит или пневмония у ребёнка 5 лет';
const QUERIES = [
  'Менингит или энцефалит у ребёнка',
  'менингит у ребенка',
  'клещевой энцефалит у ребенка',
  'бронхит или пневмония у ребёнка 5 лет',
  'ангина или фарингит у ребенка',
  'гастроэнтерит у ребёнка',
  'понос или рвота у ребенка 2 лет',
  'ОРВИ или бронхит у взрослого',
  'лихорадка кашель тахипноэ',
  'аугментин пневмония',
];

function adb(...args: string[]): string {
  const result = Bun.spawnSync(['adb', '-s', SERIAL, ...args], { stdout: 'pipe', stderr: 'pipe' });
  return result.stdout.toString();
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0
    ? Number.NaN
    : (sorted[Math.floor((sorted.length - 1) / 2)] ?? Number.NaN);
};
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0
    ? Number.NaN
    : (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? Number.NaN);
};
const round = (value: number) => Math.round(value * 10) / 10;

function coldStart(pkg: string, activity: string): number {
  adb('shell', 'am', 'force-stop', pkg);
  const output = adb('shell', 'am', 'start', '-W', '-n', `${pkg}/${activity}`);
  return Number(/TotalTime: (\d+)/u.exec(output)?.[1] ?? Number.NaN);
}

// ---- Native ---------------------------------------------------------------------------------

async function nativeSearchReady(): Promise<{ startMs: number; readyMs: number }> {
  adb('logcat', '-c');
  const startMs = coldStart(NATIVE, NATIVE_ACTIVITY);
  for (let waited = 0; waited < 60_000; waited += 250) {
    const line = adb('logcat', '-d', '-s', 'MiniMedNativeSpike:I');
    const ready = /search-ready tookMs=(\d+)/u.exec(line);
    if (ready) return { startMs, readyMs: Number(ready[1]) };
    await sleep(250);
  }
  return { startMs, readyMs: Number.NaN };
}

async function nativeQuery(query: string): Promise<{ ms: number; groups: number }> {
  adb('logcat', '-c');
  // One shell string so multi-word Cyrillic stays one extra.
  adb(
    'shell',
    `am broadcast -a dev.localmed.nativespike.BENCH_QUERY --es query '${query.replaceAll("'", '')}'`,
  );
  for (let waited = 0; waited < 30_000; waited += 100) {
    const line = adb('logcat', '-d', '-s', 'MiniMedNativeSpikeBench:I');
    const match = /totalToFrameMs=(\d+(?:\.\d+)?) resultGroups=(\d+)/u.exec(line);
    if (match) return { ms: Number(match[1]), groups: Number(match[2]) };
    await sleep(100);
  }
  return { ms: Number.NaN, groups: 0 };
}

// ---- WebView (DevTools protocol) ------------------------------------------------------------

class DevTools {
  private socket!: WebSocket;
  private next = 1;
  private pending = new Map<number, (value: unknown) => void>();

  static async attach(pkg: string): Promise<DevTools> {
    const pid = adb('shell', 'pidof', pkg).trim();
    if (!pid) throw new Error(`${pkg} is not running`);
    adb('forward', 'tcp:9333', `localabstract:webview_devtools_remote_${pid}`);
    const targets = (await (await fetch('http://127.0.0.1:9333/json')).json()) as {
      type: string;
      webSocketDebuggerUrl: string;
    }[];
    const page = targets.find((target) => target.type === 'page');
    if (!page) throw new Error('No WebView page target');
    const tools = new DevTools();
    tools.socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((done) => tools.socket.addEventListener('open', done, { once: true }));
    tools.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown };
      if (message.id && tools.pending.has(message.id)) {
        tools.pending.get(message.id)?.(message.result);
        tools.pending.delete(message.id);
      }
    });
    return tools;
  }

  async evaluate<T>(expression: string): Promise<T> {
    const id = this.next++;
    const result = new Promise<unknown>((done) => this.pending.set(id, done));
    this.socket.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
    const value = (await result) as { result?: { value?: T } };
    return value.result?.value as T;
  }

  close(): void {
    this.socket.close();
    adb('forward', '--remove', 'tcp:9333');
  }
}

const WEB_QUERY = (query: string) => `(async () => {
  const input = document.querySelector('[data-testid="search-input"]');
  if (!input) return { ms: null, groups: 0 };
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
  set.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true }));
  for (let i = 0; i < 100 && document.querySelector('.result-group-header'); i++) await new Promise((r) => setTimeout(r, 50));
  set.call(input, ${JSON.stringify(query)}); input.dispatchEvent(new Event('input', { bubbles: true }));
  const t0 = performance.now();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  return await new Promise((resolve) => {
    const tick = () => {
      const groups = document.querySelectorAll('.result-group-header').length;
      if (groups > 0) { requestAnimationFrame(() => resolve({ ms: performance.now() - t0, groups })); return; }
      if (performance.now() - t0 > 30000) { resolve({ ms: null, groups: 0 }); return; }
      requestAnimationFrame(tick);
    };
    tick();
  });
})()`;

async function webSearchReady(): Promise<{ startMs: number; readyMs: number }> {
  const startMs = coldStart(WEB, WEB_ACTIVITY);
  await sleep(1500);
  const tools = await DevTools.attach(WEB);
  let readyMs = Number.NaN;
  for (let waited = 0; waited < 60_000; waited += 250) {
    const mark = await tools.evaluate<number | null>(
      `(() => { const e = performance.getEntriesByName('minimed:search-ready')[0]; const i = document.querySelector('[data-testid="search-input"]'); return e && i && !i.disabled ? e.startTime : null; })()`,
    );
    if (typeof mark === 'number') {
      readyMs = mark;
      break;
    }
    await sleep(250);
  }
  tools.close();
  return { startMs, readyMs };
}

// ---- Scrolling and memory -------------------------------------------------------------------

function scrollFrames(pkg: string): Record<string, number> {
  adb('shell', 'dumpsys', 'gfxinfo', pkg, 'reset');
  for (let i = 0; i < 20; i++) {
    adb(
      'shell',
      'input',
      'swipe',
      '600',
      i % 2 ? '900' : '2000',
      '600',
      i % 2 ? '2000' : '900',
      '220',
    );
    Bun.sleepSync(350);
  }
  const lines = adb('shell', 'dumpsys', 'gfxinfo', pkg, 'framestats').split('\n');
  const header = lines.find((line) => line.startsWith('Flags,'))?.split(',') ?? [];
  const intended = header.indexOf('IntendedVsync');
  const completed = header.indexOf('FrameCompleted');
  const flags = header.indexOf('Flags');
  const rows = lines
    .filter((line) => /^\d/u.test(line) && line.split(',').length > 10)
    .map((line) => line.split(','))
    .filter((row) => row[flags] === '0');
  const durations = rows.map((row) => (Number(row[completed]) - Number(row[intended])) / 1e6);
  const vsyncs = rows.map((row) => Number(row[intended]));
  const intervals = vsyncs
    .slice(1)
    .map((value, index) => (value - (vsyncs[index] ?? value)) / 1e6)
    .filter((value) => value > 0 && value < 40);
  return {
    frames: durations.length,
    vsyncIntervalMs: round(median(intervals)),
    p50: round(percentile(durations, 0.5)),
    p90: round(percentile(durations, 0.9)),
    p99: round(percentile(durations, 0.99)),
    over8_3Percent: round(
      (100 * durations.filter((value) => value > 8.33).length) / Math.max(1, durations.length),
    ),
    over16_7Percent: round(
      (100 * durations.filter((value) => value > 16.67).length) / Math.max(1, durations.length),
    ),
  };
}

function memoryKb(pkg: string): number {
  return Number(
    /TOTAL PSS:\s+(\d+)/u.exec(adb('shell', 'dumpsys', 'meminfo', pkg))?.[1] ?? Number.NaN,
  );
}

// ---- Run ------------------------------------------------------------------------------------

const report: Record<string, unknown> = {
  serial: SERIAL,
  native: NATIVE,
  web: WEB,
  reps: REPS,
  queries: QUERIES,
};

console.log('native: cold start and search-ready');
const nativeRuns: { startMs: number; readyMs: number }[] = [];
for (let i = 0; i < REPS; i++) nativeRuns.push(await nativeSearchReady());
await sleep(4000);
console.log('native: queries');
const nativeQueries: { query: string; ms: number; groups: number }[] = [];
for (let rep = 0; rep < REPS; rep++)
  for (const query of QUERIES) nativeQueries.push({ query, ...(await nativeQuery(query)) });
await nativeQuery(SCROLL_QUERY);
await sleep(1500);
const nativeScroll = scrollFrames(NATIVE);
const nativeMemory = memoryKb(NATIVE);
adb('shell', 'am', 'force-stop', NATIVE);

console.log('web: cold start and search-ready');
const webRuns: { startMs: number; readyMs: number }[] = [];
for (let i = 0; i < REPS; i++) webRuns.push(await webSearchReady());
console.log('web: queries');
const tools = await DevTools.attach(WEB);
const webQueries: { query: string; ms: number; groups: number }[] = [];
for (let rep = 0; rep < REPS; rep++)
  for (const query of QUERIES) {
    const result = await tools.evaluate<{ ms: number | null; groups: number }>(WEB_QUERY(query));
    webQueries.push({ query, ms: result?.ms ?? Number.NaN, groups: result?.groups ?? 0 });
  }
await tools.evaluate(WEB_QUERY(SCROLL_QUERY));
tools.close();
await sleep(1500);
const webScroll = scrollFrames(WEB);
const webMemory = memoryKb(WEB);

const summarize = (runs: { ms: number }[]) => {
  const ok = runs.map((run) => run.ms).filter(Number.isFinite);
  return {
    n: ok.length,
    failed: runs.length - ok.length,
    median: round(median(ok)),
    p95: round(percentile(ok, 0.95)),
  };
};
report.native = {
  coldStartMs: {
    median: median(nativeRuns.map((run) => run.startMs)),
    runs: nativeRuns.map((run) => run.startMs),
  },
  searchReadyMs: {
    median: median(nativeRuns.map((run) => run.readyMs)),
    runs: nativeRuns.map((run) => run.readyMs),
  },
  query: summarize(nativeQueries),
  scroll: nativeScroll,
  memoryPssKb: nativeMemory,
  queries: nativeQueries,
};
report.web = {
  coldStartMs: {
    median: median(webRuns.map((run) => run.startMs)),
    runs: webRuns.map((run) => run.startMs),
  },
  searchReadyMs: {
    median: round(median(webRuns.map((run) => run.readyMs))),
    runs: webRuns.map((run) => round(run.readyMs)),
  },
  query: summarize(webQueries),
  scroll: webScroll,
  memoryPssKb: webMemory,
  queries: webQueries,
};
const out = resolve(import.meta.dir, '../playwright/device-app-bench.json');
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
for (const side of ['native', 'web'] as const) {
  const data = report[side] as Record<string, unknown>;
  console.log(
    side,
    JSON.stringify({
      coldStart: data.coldStartMs,
      ready: data.searchReadyMs,
      query: data.query,
      scroll: data.scroll,
      memoryPssKb: data.memoryPssKb,
    }),
  );
}
console.log(`Wrote ${out}`);
