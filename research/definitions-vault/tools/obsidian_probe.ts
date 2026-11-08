// Measures Obsidian desktop open time for one vault in an isolated profile (never the owner's).
//   bun obsidian_probe.ts <vault-dir> <profile-dir> [port]
// Launches Obsidian with --user-data-dir=<profile-dir> and a DevTools port, polls the renderer
// until the workspace layout is ready and the metadata cache has indexed every Markdown file,
// prints timings as JSON, then quits that instance only.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [vaultArg, profileArg, portArg] = process.argv.slice(2);
const vault = resolve(vaultArg);
const profile = resolve(profileArg);
const port = Number(portArg ?? 9333);
const BIN = '/Applications/TextEdit/Obsidian.app/Contents/MacOS/Obsidian';
const ASAR = '/Users/d/Library/Application Support/obsidian/obsidian-1.15.0.asar';

mkdirSync(profile, { recursive: true });
if (!existsSync(join(profile, 'obsidian-1.15.0.asar')))
  copyFileSync(ASAR, join(profile, 'obsidian-1.15.0.asar'));
writeFileSync(
  join(profile, 'obsidian.json'),
  JSON.stringify({
    vaults: { probe0000000001: { path: vault, ts: Date.now(), open: true } },
    updateDisabled: true,
  }),
);

const t0 = performance.now();
const child = spawn(BIN, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], {
  stdio: 'ignore',
});
const ms = () => Math.round(performance.now() - t0);
const marks: Record<string, number | string> = {};

async function target(): Promise<string> {
  for (;;) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
        type: string;
        url: string;
        webSocketDebuggerUrl: string;
      }[];
      const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await Bun.sleep(50);
  }
}

const wsUrl = await target();
marks.devtools_ms = ms();
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map<number, (v: unknown) => void>();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)?.(m.result?.result?.value);
    pending.delete(m.id);
  }
});
const evaluate = (expression: string) =>
  new Promise<unknown>((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(
      JSON.stringify({
        id: i,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }),
    );
  });

const PROBE = `(() => { const a = window.app; if (!a || !a.vault) return null;
  const files = a.vault.getMarkdownFiles().length;
  const cached = a.metadataCache && a.metadataCache.fileCache ? Object.keys(a.metadataCache.fileCache).length : 0;
  const links = a.metadataCache && a.metadataCache.resolvedLinks ? Object.keys(a.metadataCache.resolvedLinks).length : 0;
  const unresolved = a.metadataCache && a.metadataCache.unresolvedLinks ? Object.values(a.metadataCache.unresolvedLinks).reduce((s, o) => s + Object.keys(o).length, 0) : 0;
  return { files, cached, links, unresolved, layout: !!(a.workspace && a.workspace.layoutReady), tasks: a.metadataCache ? a.metadataCache.inProgressTaskCount : -1 }; })()`;

const deadline = 600_000;
let last: Record<string, number | boolean> | null = null;
let stable = 0;
for (;;) {
  const v = (await evaluate(PROBE)) as Record<string, number | boolean> | null;
  if (v) {
    if (v.layout && marks.layout_ready_ms === undefined) marks.layout_ready_ms = ms();
    if (v.files && marks.files_listed_ms === undefined) marks.files_listed_ms = ms();
    last = v;
    const done = v.layout && (v.files as number) > 0 && v.cached === v.files && v.tasks === 0;
    stable = done ? stable + 1 : 0;
    if (stable === 3) {
      marks.indexed_ms = ms();
      break;
    }
  }
  if (ms() > deadline) {
    marks.timeout = '600s';
    break;
  }
  await Bun.sleep(100);
}
// search: Obsidian's global search over the whole vault (core plugin), measured in the renderer
marks.search =
  (await evaluate(`(async () => { const t = performance.now(); const files = app.vault.getMarkdownFiles(); let hits = 0;
  for (const f of files) { const s = await app.vault.cachedRead(f); if (s.includes("кровотечени")) hits++; }
  return { ms: Math.round(performance.now() - t), hits }; })()`)) as string;
marks.state = JSON.stringify(last);
if (process.env.DUMP_UNRESOLVED)
  marks.unresolved = JSON.stringify(
    await evaluate(
      `Object.entries(app.metadataCache.unresolvedLinks).filter(([,o]) => Object.keys(o).length).slice(0, 20)`,
    ),
  );
marks.version = (await evaluate(`require("electron").ipcRenderer.sendSync("version")`)) as string;
{
  const ps = await new Response(Bun.spawn(['ps', '-A', '-o', 'time=,args=']).stdout).text();
  let cpu = 0;
  for (const line of ps.split('\n')) {
    if (!line.includes(profile)) continue;
    const t = line.trim().split(/\s+/)[0];
    const parts = t.split(':').map(Number);
    cpu +=
      parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  }
  marks.cpu_s_all_processes = Math.round(cpu * 10) / 10;
}
marks.rss_mb =
  Number(
    (
      await new Response(Bun.spawn(['ps', '-o', 'rss=', '-p', String(child.pid)]).stdout).text()
    ).trim(),
  ) / 1024;
console.log(JSON.stringify(marks));
ws.close();
child.kill('SIGTERM');
await Bun.sleep(1500);
if (child.exitCode === null) child.kill('SIGKILL');
process.exit(0);
