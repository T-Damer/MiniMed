import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { findCalculator } from '@/features/calculators/calculator-registry';
import { getCalculatorSchema } from '@/features/calculators/calculator-schema-catalog';
import { calculatorFileUrl, streamCalculator } from '@/features/calculators/calculator-stream';

const pack = JSON.parse(
  readFileSync(
    new URL('../../../../../content/tool-modules/neurology-rehab.json', import.meta.url),
    'utf8',
  ),
) as { tools: { id: string }[] };
const ciwa = pack.tools.find((tool) => tool.id === 'minimed.calculator.ciwa-ar');
const base = 'https://example.test/app/';

describe('one calculator read on its own', () => {
  it('reads the one record and makes the calculator runnable', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(ciwa), { status: 200 }));
    await expect(streamCalculator('minimed.calculator.ciwa-ar', fetcher, base)).resolves.toBe(
      'ready',
    );
    expect(fetcher).toHaveBeenCalledWith(
      calculatorFileUrl('minimed.calculator.ciwa-ar', base),
      expect.anything(),
    );
    expect(getCalculatorSchema('minimed.calculator.ciwa-ar')?.inputs).toHaveLength(10);
    expect(findCalculator('minimed.calculator.ciwa-ar')?.state).toBe('available');
    // Already read: no second request.
    await expect(streamCalculator('minimed.calculator.ciwa-ar', fetcher, base)).resolves.toBe(
      'ready',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('tells a missing calculator from an unreachable file', async () => {
    const missing = vi.fn(async () => new Response('not found', { status: 404 }));
    await expect(streamCalculator('minimed.calculator.nope', missing, base)).resolves.toBe(
      'missing',
    );
    // A static host's own page in place of the record is not this calculator.
    const page = vi.fn(async () => new Response('<!doctype html>', { status: 200 }));
    await expect(streamCalculator('minimed.calculator.nope2', page, base)).resolves.toBe('missing');
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(streamCalculator('minimed.calculator.abcd2', offline, base)).resolves.toBe(
      'unavailable',
    );
    await expect(streamCalculator('../secrets', offline, base)).resolves.toBe('missing');
    expect(offline).toHaveBeenCalledTimes(1);
  });
});
