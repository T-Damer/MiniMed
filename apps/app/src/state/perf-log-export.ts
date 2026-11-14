import { shareSystemFile } from '@/state/native-share';

import {
  analysePerfLog,
  PERF_LOG_FORMAT,
  PERF_LOG_FORMAT_VERSION,
  type PerfLogFile,
  type PerfLogSession,
  perfLogSummary,
} from './perf-log-analysis';
import { readPerfSessions } from './perf-log-collector';

/** The shared file: the stored sessions and a short Russian summary on top. */
export function buildPerfLogFile(
  sessions: readonly PerfLogSession[],
  exportedAt: Date = new Date(),
): PerfLogFile {
  const summary = perfLogSummary(analysePerfLog({ sessions }));
  return {
    format: PERF_LOG_FORMAT,
    formatVersion: PERF_LOG_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    summary,
    sessions,
  };
}

export function perfLogFileName(version: string, at: Date = new Date()): string {
  const stamp = at.toISOString().slice(0, 16).replace(/[-:]/gu, '').replace('T', '-');
  return `minimed-perf-${version}-${stamp}.json`;
}

export type PerfLogShareOutcome = 'shared' | 'cancelled' | 'downloaded' | 'empty';

/** «Поделиться журналом»: the share sheet in the app, a download in a browser. */
export async function sharePerfLog(): Promise<{
  readonly outcome: PerfLogShareOutcome;
  readonly summary: readonly string[];
}> {
  const sessions = await readPerfSessions();
  if (sessions.every((session) => session.entries.length === 0)) {
    return { outcome: 'empty', summary: [] };
  }
  const file = buildPerfLogFile(sessions);
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
  const outcome = await shareSystemFile({
    title: 'Журнал производительности MiniMed',
    fileName: perfLogFileName(sessions.at(-1)?.version ?? 'unknown'),
    mimeType: 'application/json',
    blob,
  });
  return { outcome, summary: file.summary };
}
