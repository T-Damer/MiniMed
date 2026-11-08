#!/usr/bin/env bun
/**
 * PERF5: turns one or two reports of `apps/app/e2e/perf-baseline.spec.ts` into Markdown tables.
 *
 *   bun scripts/perf-compare.ts before.json [after.json]
 *
 * With two reports each cell is «before → after».
 */
import { readFileSync } from 'node:fs';

type Json = Record<string, unknown>;

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath) {
  console.error('usage: bun scripts/perf-compare.ts before.json [after.json]');
  process.exit(2);
}
const before = JSON.parse(readFileSync(beforePath, 'utf8')) as Json;
const after = afterPath ? (JSON.parse(readFileSync(afterPath, 'utf8')) as Json) : undefined;

function at(report: Json | undefined, path: string): unknown {
  let value: unknown = report;
  for (const key of path.split('|')) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Json)[key];
  }
  return value;
}

function cell(path: string): string {
  const show = (value: unknown): string =>
    value === undefined || value === null
      ? '—'
      : typeof value === 'number'
        ? String(Math.round(value * 10) / 10)
        : String(value);
  const left = show(at(before, path));
  return after ? `${left} → ${show(at(after, path))}` : left;
}

function table(
  title: string,
  columns: readonly [string, string][],
  rows: readonly [string, string][],
): string {
  const head = `| ${['', ...columns.map(([label]) => label)].join(' | ')} |`;
  const rule = `| ${['---', ...columns.map(() => '---:')].join(' | ')} |`;
  const body = rows.map(
    ([label, prefix]) =>
      `| ${[label, ...columns.map(([, path]) => cell(`${prefix}|${path}`))].join(' | ')} |`,
  );
  return [`### ${title}`, '', head, rule, ...body, ''].join('\n');
}

const out: string[] = [];
out.push(
  `Reports: \`${beforePath}\`${afterPath ? ` → \`${afterPath}\`` : ''} (${String(at(before, 'throttle'))}, ${String(at(before, 'viewport'))}; medians of ${String(at(before, 'repeats'))} app starts)`,
  '',
);

out.push(
  table(
    'Start-up (ms from navigation, KB decoded)',
    [
      ['FCP', 'firstContentfulPaintMs'],
      ['boot reveal', 'bootRevealMs'],
      ['navigation ready', 'navigationReadyMs'],
      ['search ready', 'searchReadyMs'],
      ['JS KB before reveal', 'jsKBBeforeReveal'],
      ['JS files before reveal', 'jsFilesBeforeReveal'],
      ['blocking ms before reveal', 'blockingMsBeforeReveal'],
      ['blocking ms before search ready', 'blockingMsBeforeSearchReady'],
    ],
    [['app start, data installed', 'startup|median']],
  ),
);

const searches = Object.keys((at(before, 'search') as Json | undefined) ?? {});
const searchRows: [string, string][] = searches.flatMap((key) => {
  const first = at(before, `search|${key}|firstAfterStart`) ? 'firstAfterStart' : 'first';
  return [
    [
      `${key} — ${first === 'firstAfterStart' ? 'first after start' : 'first'}`,
      `search|${key}|${first}`,
    ],
    [`${key} — repeat`, `search|${key}|repeat`],
  ] as [string, string][];
});
out.push(
  table(
    'Search (ms after the last keystroke)',
    [
      ['first result', 'firstResultMs'],
      ['«По названию»', 'titleMatchesMs'],
      ['final list', 'finalMs'],
      ['groups', 'groups'],
      ['typing long tasks', 'typingLongTasks|count'],
      ['typing blocking ms', 'typingLongTasks|blockingMs'],
      ['search long tasks', 'searchLongTasks|count'],
      ['search longest task', 'searchLongTasks|maxMs'],
      ['search blocking ms', 'searchLongTasks|blockingMs'],
      ['worker search ms', 'workerCalls|search|totalMs'],
      ['worker calls', 'workerCalls|search|count'],
    ],
    searchRows,
  ),
);

const documents = Object.keys((at(before, 'reader') as Json | undefined) ?? {});
out.push(
  table(
    'Reader open (ms from the tap)',
    [
      ['first text', 'firstTextMs'],
      ['all sections mounted', 'allSectionsMountedMs'],
      ['interactive', 'interactiveMs'],
      ['«Другие»', 'otherChipsMs'],
      ['long tasks', 'longTasks|count'],
      ['longest task', 'longTasks|maxMs'],
      ['blocking ms', 'longTasks|blockingMs'],
      ['layouts', 'browser|layouts'],
      ['style recalcs', 'browser|styleRecalcs'],
      ['sections', 'sections'],
    ],
    documents.flatMap(
      (key) =>
        [
          [`${key} — open`, `reader|${key}|open`],
          [`${key} — reopen`, `reader|${key}|reopen`],
        ] as [string, string][],
    ),
  ),
);
out.push(
  table(
    'Reader scroll (frame times ms; layout/style counts during the scroll)',
    [
      ['p50', 'frameMsP50'],
      ['p95', 'frameMsP95'],
      ['max', 'frameMsMax'],
      ['frames >25 ms', 'framesOver25ms'],
      ['frames', 'frames'],
      ['long tasks', 'longTasks|count'],
      ['layouts', 'browser|layouts'],
      ['style recalcs', 'browser|styleRecalcs'],
      ['layout ms', 'browser|layoutMs'],
      ['style ms', 'browser|styleMs'],
    ],
    documents.flatMap(
      (key) =>
        [
          [`${key} — read`, `reader|${key}|scroll|read`],
          [`${key} — fling`, `reader|${key}|scroll|fling`],
        ] as [string, string][],
    ),
  ),
);
out.push(
  table(
    'Reader contents panel and memory',
    [
      ['contents open ms', 'contents|openMs'],
      ['contents items', 'contents|items'],
      ['open blocking ms', 'contents|openLongTasks|blockingMs'],
      ['jump blocking ms', 'contents|jumpLongTasks|blockingMs'],
      ['heap MB after GC', 'memoryAfterGc|heapMB'],
      ['DOM nodes', 'memoryAfterGc|domNodes'],
      ['page height px', 'scroll|scrollHeightPx'],
    ],
    documents.map((key) => [key, `reader|${key}`] as [string, string]),
  ),
);

console.log(out.join('\n'));
