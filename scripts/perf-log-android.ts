/**
 * PERFLOG1: a performance log from the Android app on an **emulator**, to check the native sampler
 * and `scripts/perf-log-report.ts` on a real WebView. Not a gate.
 *
 * It turns the log on (the same localStorage key the Settings switch writes), reloads, visits the
 * search home and Settings, scrolls, records `PERF_LOG_SECONDS` with Chromium's fake microphone (its
 * built-in beep; no speech, no real microphone), stops, deletes that test recording, waits for one
 * collector tick and writes the log as the app would share it.
 *
 *   ANDROID_SERIAL=emulator-5554 PERF_LOG_PACKAGE=org.med.web.perflog1 \
 *     PERF_LOG_OUT=perf-log-emulator.json bun scripts/perf-log-android.ts
 *   bun scripts/perf-log-report.ts perf-log-emulator.json
 *
 * Emulators only: a phone's log comes from the owner's own «Поделиться журналом».
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  analysePerfLog,
  PERF_LOG_FORMAT,
  PERF_LOG_FORMAT_VERSION,
  type PerfLogFile,
  type PerfLogSession,
  perfLogSummary,
} from '../apps/app/src/state/perf-log-analysis';

const SERIAL = process.env['ANDROID_SERIAL'] ?? '';
const PACKAGE = process.env['PERF_LOG_PACKAGE'] ?? 'org.med.web';
const SECONDS = Number(process.env['PERF_LOG_SECONDS'] ?? '60');
const PORT = Number(process.env['PERF_LOG_CDP_PORT'] ?? '9341');
const OUT = resolve(process.env['PERF_LOG_OUT'] ?? 'perf-log-emulator.json');

if (!/^emulator-\d+$/u.test(SERIAL)) {
  throw new Error('Set ANDROID_SERIAL to an emulator (emulator-5554); phones are not driven.');
}

function adb(...args: string[]): string {
  const result = spawnSync('adb', ['-s', SERIAL, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`adb ${args.join(' ')}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

class Cdp {
  private next = 0;
  private readonly pending = new Map<number, (value: Record<string, unknown>) => void>();

  private constructor(private readonly socket: WebSocket) {
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        method?: string;
        result?: Record<string, unknown>;
        error?: { message: string };
      };
      if (message.method === 'Page.javascriptDialogOpening') {
        void this.send('Page.handleJavaScriptDialog', { accept: true });
        return;
      }
      if (message.id === undefined) return;
      const done = this.pending.get(message.id);
      this.pending.delete(message.id);
      done?.(message.error ? { __error: message.error.message } : (message.result ?? {}));
    };
  }

  static async open(): Promise<Cdp> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const pid = spawnSync('adb', ['-s', SERIAL, 'shell', 'pidof', PACKAGE], {
        encoding: 'utf8',
      }).stdout.trim();
      if (pid) {
        adb('forward', `tcp:${String(PORT)}`, `localabstract:webview_devtools_remote_${pid}`);
        try {
          const targets = (await (await fetch(`http://127.0.0.1:${String(PORT)}/json`)).json()) as {
            type: string;
            webSocketDebuggerUrl: string;
          }[];
          const page = targets.find((target) => target.type === 'page');
          if (page) {
            const socket = new WebSocket(page.webSocketDebuggerUrl);
            await new Promise((ready, fail) => {
              socket.onopen = ready;
              socket.onerror = fail;
            });
            const cdp = new Cdp(socket);
            await cdp.send('Page.enable');
            return cdp;
          }
        } catch {
          // The WebView is still starting.
        }
      }
      await sleep(1000);
    }
    throw new Error('The app WebView did not open a DevTools socket.');
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    this.next += 1;
    const id = this.next;
    return new Promise((done) => {
      this.pending.set(id, done);
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval<T>(expression: string): Promise<T> {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result['exceptionDetails'] || result['__error']) {
      throw new Error(`evaluate failed: ${JSON.stringify(result).slice(0, 400)}`);
    }
    return (result['result'] as { value?: T } | undefined)?.value as T;
  }

  async waitFor(expression: string, timeoutMs: number, what: string): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await this.eval<boolean>(`Boolean(${expression})`))) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
      await sleep(500);
    }
  }

  close(): void {
    this.socket.close();
  }
}

const HELPERS = `
  window.__pl = {
    button(label, root) {
      const scope = root ? document.querySelector(root) : document;
      if (!scope) return null;
      const re = new RegExp(label, 'u');
      return [...scope.querySelectorAll('button')].find((b) =>
        b.offsetParent !== null && (re.test(b.getAttribute('aria-label') ?? '') || re.test(b.textContent ?? '')),
      ) ?? null;
    },
    click(label, root) {
      const b = this.button(label, root);
      if (!b) return false;
      b.click();
      return true;
    },
  };
  true;
`;

async function scroll(cdp: Cdp): Promise<void> {
  await cdp.send('Input.synthesizeScrollGesture', {
    x: 180,
    y: 500,
    yDistance: -600,
    speed: 1200,
    gestureSourceType: 'touch',
  });
  await cdp.send('Input.synthesizeScrollGesture', {
    x: 180,
    y: 300,
    yDistance: 600,
    speed: 1200,
    gestureSourceType: 'touch',
  });
}

async function main(): Promise<void> {
  // Chromium's fake microphone (a beep) instead of the emulator's input; userdebug images read it.
  adb(
    'shell',
    `echo '_ --use-fake-device-for-media-stream --use-fake-ui-for-media-stream' > /data/local/tmp/webview-command-line`,
  );
  adb('shell', 'pm', 'grant', PACKAGE, 'android.permission.RECORD_AUDIO');
  adb('shell', 'am', 'force-stop', PACKAGE);
  adb('shell', 'monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1');
  const cdp = await Cdp.open();
  await cdp.waitFor('document.querySelector("#root")?.childElementCount', 60_000, 'the app');
  await cdp.eval(HELPERS);
  // The Settings switch, as the owner turns it on.
  await cdp.eval(`location.hash = '#/settings/general'; true`);
  const row = '[data-testid="perf-log-settings"]';
  await cdp.waitFor(`document.querySelector('${row} [role=switch]')`, 30_000, 'the switch');
  if (
    (await cdp.eval<string>(
      `document.querySelector('${row} [role=switch]').getAttribute('aria-checked')`,
    )) !== 'true'
  ) {
    await cdp.eval(`document.querySelector('${row} [role=switch]').click(); true`);
  }
  // A clean log for this run: the bin («Очистить журнал») empties earlier sessions.
  await cdp.eval(`document.querySelector('${row} [aria-label="Очистить журнал"]')?.click(); true`);
  await sleep(1_000);
  await cdp.waitFor(
    `document.querySelector('${row} [data-testid=perf-log-progress]')?.textContent.includes('Пишется')`,
    30_000,
    'the performance log to start',
  );
  console.log('log on');

  await cdp.eval(`location.hash = '#/search'; true`);
  await sleep(6_000);
  await scroll(cdp);
  await cdp.eval(`location.hash = '#/settings/general'; true`);
  await sleep(3_000);
  await scroll(cdp);
  await cdp.eval(`location.hash = '#/notes'; true`);
  await sleep(3_000);
  await cdp.eval(`location.hash = '#/search'; true`);
  await sleep(3_000);

  // A fresh emulator install has no search core yet: it is downloaded as the doctor would (77 MB),
  // so the log also shows the core opening; the recorder is under «Все инструменты» then.
  if (await cdp.eval<boolean>(`__pl.click('Скачать основную базу')`)) {
    console.log('downloading the core');
    await cdp.waitFor(
      `performance.getEntriesByName('minimed:search-ready').length > 0`,
      600_000,
      'the core',
    );
    await sleep(5_000);
  }
  await cdp.eval(HELPERS);
  if (!(await cdp.eval<boolean>(`__pl.click('^Все инструменты$')`))) {
    throw new Error('No «Все инструменты» button.');
  }
  await sleep(1_000);
  await cdp.eval(
    `[...document.querySelectorAll('.quick-tool-row__open')].find((b) => b.textContent.includes('Запись беседы'))?.click(); true`,
  );
  const live = '[data-testid="conversation-live"]';
  await cdp.waitFor(`document.querySelector('${live}')`, 15_000, 'the recorder window');
  await cdp.eval(`__pl.click('^Начать запись$', '${live}')`);
  /** The window may fold into the floating button; this opens it again. */
  const openWindow = async (): Promise<void> => {
    if (!(await cdp.eval<boolean>(`Boolean(__pl.button('^Стоп$', '${live}'))`))) {
      await cdp.eval(`document.querySelector('.recorder-fab')?.click(); true`);
      await sleep(1_200);
    }
  };
  if (process.env['PERF_LOG_NATIVE_MODEL'] === '1') {
    // GigaAM for the live text (256 MB, once per install): the log then has native stretches.
    await openWindow();
    if (await cdp.eval<boolean>(`__pl.click('Скачать', '${live} .asr-model-card')`)) {
      console.log('downloading the GigaAM models');
      await cdp.waitFor(
        `!document.querySelector('${live} .asr-model-card')`,
        900_000,
        'the GigaAM models',
      );
    }
  }
  console.log(`recording ${String(SECONDS)} s (fake microphone)`);
  const until = Date.now() + SECONDS * 1000;
  while (Date.now() < until) {
    await sleep(10_000);
    await scroll(cdp).catch(() => undefined);
  }
  await openWindow();
  if (!(await cdp.eval<boolean>(`__pl.click('^Стоп$', '${live}')`))) {
    throw new Error('No «Стоп» in the recorder window.');
  }
  await cdp.waitFor(`__pl.button('^Удалить запись$')`, 30_000, 'the saved recording sheet');
  // The test recording (a beep) is deleted again.
  await cdp.eval(`__pl.click('^Удалить запись$')`);
  await sleep(800);
  await cdp.eval(
    `[...document.querySelectorAll('[role=dialog] button')].filter((b) => b.textContent.trim() === 'Удалить').at(-1)?.click(); true`,
  );
  await sleep(16_000);

  // The stored sessions straight from IndexedDB, after a write the share button would also make.
  // Home: the app goes to the background, which writes the log (as on a phone).
  adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
  await sleep(3_000);
  const sessions = await cdp.eval<PerfLogSession[]>(`new Promise((resolve, reject) => {
    const open = indexedDB.open('minimed-perf-log', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = open.result.transaction('sessions').objectStore('sessions').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    };
  })`);
  cdp.close();
  const file: PerfLogFile = {
    format: PERF_LOG_FORMAT,
    formatVersion: PERF_LOG_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    summary: perfLogSummary(analysePerfLog({ sessions })),
    sessions,
  };
  writeFileSync(OUT, JSON.stringify(file));
  console.log(`${String(sessions.reduce((sum, s) => sum + s.entries.length, 0))} entries → ${OUT}`);
  for (const line of file.summary) console.log(`  ${line}`);
  adb('shell', 'rm', '-f', '/data/local/tmp/webview-command-line');
}

await main();
