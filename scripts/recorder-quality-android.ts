/**
 * REC2: live text of the conversation recorder in the Android app on an **emulator**, scored by
 * word error rate against the same synthetic dialogue as the browser run
 * (`apps/app/e2e/recorder-quality.spec.ts`, docs/research/recorder-perf-2026-11.md). Not a gate.
 *
 * The emulator's WebView gets Chromium's fake microphone through its command-line file (userdebug
 * images read `/data/local/tmp/webview-command-line`), fed by `REC_QUALITY_WAV` copied into the
 * app's own files, so no real microphone — and no real speech — is ever involved. The app's page is
 * driven over its DevTools socket with plain CDP (Playwright's `connectOverCDP` needs browser
 * contexts, which WebView does not offer): open «Запись беседы», install the native models if the
 * card asks, record `REC_QUALITY_SECONDS`, stop and score the text.
 *
 *   ANDROID_SERIAL=emulator-5554 REC_QUALITY_WAV=dialog48k.wav REC_QUALITY_SCRIPT=dialog-script.txt \
 *     bun scripts/recorder-quality-android.ts
 *
 * It refuses any serial that is not an emulator unless `REC_QUALITY_DEVICE_OK` names that exact
 * serial (a phone, only with its owner's OK). Even then the microphone is the fake one fed by the
 * synthetic WAV, the app's settings are left alone, and both test recordings are deleted at the end.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { loopedWer } from '../apps/app/e2e/word-error-rate';

const SERIAL = process.env['ANDROID_SERIAL'] ?? '';
const PACKAGE = process.env['REC_QUALITY_PACKAGE'] ?? 'org.med.web';
const WAV = process.env['REC_QUALITY_WAV'] ?? '';
const SCRIPT = process.env['REC_QUALITY_SCRIPT'] ?? '';
const SECONDS = Number(process.env['REC_QUALITY_SECONDS'] ?? '130');
const LOOP_SECONDS = Number(process.env['REC_QUALITY_LOOP_SECONDS'] ?? '42.47');
const PORT = Number(process.env['REC_QUALITY_CDP_PORT'] ?? '9339');
const OUT = resolve(process.env['REC_QUALITY_OUT'] ?? 'output/recorder-quality-android.json');

const EMULATOR = /^emulator-\d+$/u.test(SERIAL);
if (!EMULATOR && (SERIAL === '' || process.env['REC_QUALITY_DEVICE_OK'] !== SERIAL)) {
  throw new Error(
    'Set ANDROID_SERIAL to an emulator; a phone needs REC_QUALITY_DEVICE_OK=<its serial> (owner OK).',
  );
}
if (!WAV || !SCRIPT) throw new Error('REC_QUALITY_WAV and REC_QUALITY_SCRIPT are required.');

function adb(...args: string[]): string {
  const result = spawnSync('adb', ['-s', SERIAL, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`adb ${args.join(' ')}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((done) => setTimeout(done, ms));
}

function log(value: Record<string, unknown>): void {
  console.log(JSON.stringify(value));
}

function launch(): void {
  adb('shell', 'am', 'force-stop', PACKAGE);
  adb('shell', 'monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1');
}

/** The synthetic WAV into the app's files (readable by its WebView), and the fake-mic flags. */
function prepareDevice(): void {
  const remoteTmp = `/data/local/tmp/${basename(WAV)}`;
  adb('push', WAV, remoteTmp);
  adb(
    'shell',
    `run-as ${PACKAGE} sh -c 'mkdir -p files && cat ${remoteTmp} > files/rec-quality.wav'`,
  );
  const target = `/data/user/0/${PACKAGE}/files/rec-quality.wav`;
  adb(
    'shell',
    `echo '_ --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-audio-capture=${target}' > /data/local/tmp/webview-command-line`,
  );
  adb('shell', 'pm', 'grant', PACKAGE, 'android.permission.RECORD_AUDIO');
  launch();
}

/** A minimal DevTools client over one page target. */
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
        // A first-time download asks before it starts (owner rule): accepted.
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
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const pid = spawnSync('adb', ['-s', SERIAL, 'shell', 'pidof', PACKAGE], {
        encoding: 'utf8',
      }).stdout.trim();
      if (pid) {
        adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);
        try {
          const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()) as {
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
    const value = result['result'] as { value?: T } | undefined;
    if (result['exceptionDetails'] || result['__error']) {
      throw new Error(`evaluate failed: ${JSON.stringify(result).slice(0, 400)}`);
    }
    return value?.value as T;
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

/** In-page helpers: buttons by accessible label or text, inside an optional root. */
const HELPERS = `
  window.__rq = {
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
    texts(selector) {
      return [...document.querySelectorAll(selector)].map((e) => (e.textContent ?? '').trim());
    },
  };
  true;
`;

const LIVE = '[data-testid="conversation-live"]';
const CARD = `${LIVE} .asr-model-card`;

/** The recording sheet open after «Стоп»: its recording (synthetic) is deleted from the app. */
async function deleteOpenRecording(cdp: Cdp): Promise<void> {
  await cdp
    .waitFor(`window.__rq.click('^Удалить запись$')`, 30_000, 'the delete button')
    .catch(async (cause: unknown) => {
      const state = await cdp.eval<string>(
        `JSON.stringify({ hash: location.hash, dialogs: [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].map((d) => d.getAttribute('aria-label') ?? d.className), toasts: window.__rq.texts('[data-sonner-toast]') })`,
      );
      log({ deleteFailed: state });
      throw cause;
    });
  await cdp.waitFor(
    `(() => { const d = [...document.querySelectorAll('[role="alertdialog"], [role="dialog"]')].at(-1); const b = d && [...d.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Удалить'); b?.click(); return b; })()`,
    10_000,
    'the delete confirmation',
  );
  await sleep(2_000);
}

async function openRecorder(cdp: Cdp): Promise<void> {
  await cdp.eval(`window.location.hash = '#/search'; true`);
  await cdp.waitFor(`window.__rq.click('^Все инструменты$')`, 60_000, 'the tools button');
  await cdp.waitFor(
    `(() => { const row = [...document.querySelectorAll('.quick-tool-row__open')].find((e) => e.textContent.includes('Запись беседы')); row?.click(); return row; })()`,
    15_000,
    'the recorder row',
  );
  await cdp.waitFor(`document.querySelector('${LIVE}')`, 15_000, 'the recorder window');
}

interface RecognitionTiming {
  readonly audioSeconds: number;
  readonly ms: number;
}

/**
 * Times every `recognizePcm` bridge call (audio length from the base64 size): the real-time factor
 * of GigaAM on this device. Only lengths and durations are kept, never audio or text.
 */
const TIMING_PROBE = `
  (() => {
    const cap = window.Capacitor;
    if (cap.__rqTimed) return true;
    const original = cap.nativePromise;
    window.__recTimings = [];
    cap.nativePromise = (plugin, method, options) => {
      const call = original.call(cap, plugin, method, options);
      if (method !== 'recognizePcm') return call;
      const audioSeconds = ((options?.pcm ?? '').length * 3) / 4 / 2 / 16000;
      const started = performance.now();
      return call.finally(() => window.__recTimings.push({ audioSeconds, ms: performance.now() - started }));
    };
    cap.__rqTimed = true;
    return true;
  })()
`;

async function main(): Promise<void> {
  prepareDevice();
  let cdp = await Cdp.open();
  // A fresh emulator install starts with onboarding and the core download offer: skipped, as in
  // e2e. A phone's own settings are never changed.
  const skipped =
    !EMULATOR ||
    (await cdp.eval<boolean>(`(() => {
    const already = localStorage.getItem('minimed:package-setup-dismissed:v1') === '1';
    localStorage.setItem('minimed:package-setup-dismissed:v1', '1');
    localStorage.setItem('minimed:core-download-consent:v1', '1');
    return already;
  })()`));
  if (!skipped) {
    cdp.close();
    launch();
    await sleep(3_000);
    cdp = await Cdp.open();
  }
  await cdp.waitFor('document.readyState === "complete"', 60_000, 'the page');
  await cdp.eval(HELPERS);
  await cdp.eval(TIMING_PROBE);
  // The guided onboarding of a fresh install covers the screen (and the screenshots): skipped.
  if (EMULATOR) {
    await cdp
      .waitFor(`window.__rq.click('^Пропустить обучение$')`, 8_000, 'onboarding')
      .catch(() => undefined);
  }

  await openRecorder(cdp);
  await cdp.waitFor(`window.__rq.click('^Начать запись$', '${LIVE}')`, 15_000, 'record');
  await cdp.waitFor(`window.__rq.button('^Стоп$', '${LIVE}')`, 15_000, 'the recording');
  // The card appears once the native models have been checked (absent when installed).
  const cardShown = await cdp
    .waitFor(`document.querySelector('${CARD}')`, 30_000, 'the card')
    .then(() => true)
    .catch(() => false);
  if (cardShown) {
    log({ card: await cdp.eval<string>(`document.querySelector('${CARD}').innerText`) });
    await cdp.eval(`window.__rq.click('Скачать|Включить|Повторить', '${CARD}')`);
  }
  const deadline = Date.now() + 25 * 60_000;
  while (await cdp.eval<boolean>(`Boolean(document.querySelector('${CARD}'))`)) {
    if (Date.now() > deadline) throw new Error('The speech models did not become ready.');
    const card = await cdp.eval<string>(
      `document.querySelector('${CARD}')?.innerText.replace(/\\s+/g, ' ') ?? ''`,
    );
    log({ card });
    if (/Повторить/u.test(card)) await cdp.eval(`window.__rq.click('Повторить', '${CARD}')`);
    await sleep(10_000);
  }
  // A clean recording: the warm-up one is stopped and deleted.
  await cdp.eval(`window.__rq.click('^Стоп$', '${LIVE}')`);
  await sleep(4_000);
  await deleteOpenRecording(cdp);

  await openRecorder(cdp);
  await cdp.eval(`window.__recTimings = []; true`);
  await cdp.waitFor(`window.__rq.click('^Начать запись$', '${LIVE}')`, 15_000, 'record');
  await cdp.waitFor(`window.__rq.button('^Стоп$', '${LIVE}')`, 15_000, 'the recording');
  const started = Date.now();
  const timeline: { readonly at: number; readonly lines: number; readonly note: string }[] = [];
  while (Date.now() - started < SECONDS * 1000) {
    await sleep(10_000);
    const point = {
      at: Math.round((Date.now() - started) / 1000),
      lines: (await cdp.eval<string[]>(`window.__rq.texts('.recorder-window__line')`)).length,
      note: (await cdp.eval<string[]>(`window.__rq.texts('.recorder-window__note')`)).join(' '),
    };
    timeline.push(point);
    log(point);
  }
  mkdirSync(resolve(OUT, '..'), { recursive: true });
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}.live.png`, Buffer.from(String(shot['data'] ?? ''), 'base64'));
  const heard = await cdp.eval<string[]>(`window.__rq.texts('.recorder-window__line')`);
  const recordedSeconds = (Date.now() - started) / 1000;
  await cdp.eval(`window.__rq.click('^Стоп$', '${LIVE}')`);
  await sleep(12_000);
  const after = await cdp.eval<string[]>(
    `window.__rq.texts('.audio-player__segment-text, .conversation-dialog__line')`,
  );
  const sheet = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}.sheet.png`, Buffer.from(String(sheet['data'] ?? ''), 'base64'));
  await deleteOpenRecording(cdp);
  const finalText = after.length >= heard.length ? after : heard;
  const calls = await cdp.eval<RecognitionTiming[]>('window.__recTimings ?? []');
  const audio = calls.reduce((sum, call) => sum + call.audioSeconds, 0);
  const busy = calls.reduce((sum, call) => sum + call.ms, 0) / 1000;
  const slowest = calls.reduce<RecognitionTiming | null>(
    (worst, call) =>
      worst && worst.ms / worst.audioSeconds >= call.ms / call.audioSeconds ? worst : call,
    null,
  );
  const result = {
    engine: 'android-native',
    recordedSeconds: Math.round(recordedSeconds),
    liveLines: heard.length,
    recognitions: calls.length,
    recognisedAudioSeconds: Math.round(audio * 10) / 10,
    realTimeFactor: audio > 0 ? Math.round((busy / audio) * 1000) / 1000 : null,
    slowestStretch: slowest,
    ...loopedWer(readFileSync(SCRIPT, 'utf8'), finalText.join(' '), recordedSeconds, LOOP_SECONDS),
    timeline,
    lines: finalText,
  };
  writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  log({ ...result, lines: finalText.length, timeline: timeline.length });
  cdp.close();
  adb(
    'shell',
    'rm',
    '-f',
    '/data/local/tmp/webview-command-line',
    `/data/local/tmp/${basename(WAV)}`,
  );
  adb('shell', `run-as ${PACKAGE} rm -f files/rec-quality.wav`);
  // Back to the real microphone: the WebView reads its flags only at start.
  launch();
  adb('forward', '--remove', `tcp:${PORT}`);
  process.exit(0);
}

await main();
