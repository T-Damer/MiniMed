import { ToolDefinitionRecordSchema } from '@localmed/contracts';

import {
  isStreamedCalculator,
  registerStreamedCalculator,
} from '@/features/calculators/calculator-registry';

/**
 * One calculator read on its own (CALCLINK, owner 2026-11-08: «без скачивания, динамическая
 * подгрузка одного калькулятора»). The build writes every calculator of the tool packs to
 * `tools/<digest>/<id>.json` (vite.config.ts `calculatorToolFiles`); a calculator whose section is
 * not installed reads that one record (9–15 KB) and runs at once. The service worker keeps what was
 * read, so it opens offline afterwards; the section pack stays the way to install everything.
 */

declare const __CALCULATOR_FILES__: string | undefined;

/** The build's calculator folder; tests and builds without the plugin read `tools/`. */
export const CALCULATOR_FILES_DIRECTORY =
  typeof __CALCULATOR_FILES__ === 'string' ? __CALCULATOR_FILES__ : 'tools';

const SAFE_ID = /^[A-Za-z0-9._-]{1,120}$/u;

export type CalculatorStreamResult = 'ready' | 'missing' | 'unavailable';

export function calculatorFileUrl(id: string, base: string = document.baseURI): string {
  return new URL(`${CALCULATOR_FILES_DIRECTORY}/${encodeURIComponent(id)}.json`, base).toString();
}

const pending = new Map<string, Promise<CalculatorStreamResult>>();

/**
 * Reads one calculator and registers it. `missing`: this build has no such calculator (a wrong or
 * removed id); `unavailable`: the file could not be read (offline before it was ever opened), and
 * the section download is the way left.
 */
export function streamCalculator(
  id: string,
  fetcher: typeof fetch = fetch,
  base?: string,
): Promise<CalculatorStreamResult> {
  if (isStreamedCalculator(id)) return Promise.resolve('ready');
  if (!SAFE_ID.test(id)) return Promise.resolve('missing');
  const running = pending.get(id);
  if (running) return running;
  const request = (async (): Promise<CalculatorStreamResult> => {
    let response: Response;
    try {
      response = await fetcher(calculatorFileUrl(id, base), { cache: 'no-cache' });
    } catch {
      return 'unavailable';
    }
    if (response.status === 404) return 'missing';
    if (!response.ok) return 'unavailable';
    const parsed = ToolDefinitionRecordSchema.safeParse(await response.json().catch(() => null));
    // A static host answers an unknown path with its own page: not a calculator, so not this one.
    if (!parsed.success || parsed.data.kind !== 'calculator' || parsed.data.id !== id) {
      return 'missing';
    }
    registerStreamedCalculator(parsed.data);
    return 'ready';
  })().finally(() => pending.delete(id));
  pending.set(id, request);
  return request;
}
