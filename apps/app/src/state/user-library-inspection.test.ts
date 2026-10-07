import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createInspectionRunner,
  type InspectionDocument,
  inspectionFailureMessage,
} from '@/state/user-library-inspection';

function setup(overrides: { readonly bytes?: Readonly<Record<string, number>> } = {}) {
  const documents = new Map<string, InspectionDocument>();
  const failures = new Map<string, string>();
  const active = { current: 0, peak: 0 };
  const order: string[] = [];
  const runner = createInspectionRunner({
    getDocument: async (id) => documents.get(id) ?? null,
    inspect: async (id, progress) => {
      active.current += 1;
      active.peak = Math.max(active.peak, active.current);
      order.push(`start:${id}`);
      try {
        await behaviours[id]?.(progress);
        progress.assertActive();
        order.push(`done:${id}`);
      } finally {
        active.current -= 1;
      }
    },
    markFailed: async (id, message) => {
      failures.set(id, message);
    },
  });
  const behaviours: Record<string, (progress: { touch: () => void }) => Promise<void>> = {};
  for (const id of ['a', 'b', 'c']) {
    documents.set(id, {
      id,
      status: 'inspecting',
      byteLength: overrides.bytes?.[id] ?? 0,
    });
  }
  return { runner, documents, failures, active, order, behaviours };
}

/** Lets the queued reads reach their first await (and arm their watchdog) before time moves. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 30; tick += 1) await Promise.resolve();
}

describe('inspectionFailureMessage', () => {
  it('keeps Russian messages and explains a library error', () => {
    expect(inspectionFailureMessage(new Error('Файл повреждён.'))).toBe('Файл повреждён.');
    expect(inspectionFailureMessage(new Error('Invalid PDF structure.'))).toBe(
      'Не удалось прочитать файл (Invalid PDF structure.)',
    );
    expect(inspectionFailureMessage('boom')).toBe('Не удалось обработать файл.');
    expect(inspectionFailureMessage(new Error('  '))).toBe('Не удалось обработать файл.');
  });
});

describe('createInspectionRunner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads documents one after another, never two at once', async () => {
    const { runner, active, order, behaviours } = setup();
    let releaseA: () => void = () => undefined;
    behaviours['a'] = () =>
      new Promise<void>((resolve) => {
        releaseA = resolve;
      });
    const first = runner.run('a');
    const second = runner.run('b');
    const third = runner.run('c');
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual(['start:a']);
    releaseA();
    await Promise.all([first, second, third]);
    expect(order).toEqual(['start:a', 'done:a', 'start:b', 'done:b', 'start:c', 'done:c']);
    expect(active.peak).toBe(1);
  });

  it('asks for a document that is already queued or running only once', async () => {
    const { runner, order } = setup();
    const first = runner.run('a');
    const again = runner.run('a');
    expect(again).toBe(first);
    await first;
    expect(order).toEqual(['start:a', 'done:a']);
    // Once it has finished, a later request (a retry) reads it again.
    await runner.run('a');
    expect(order.filter((entry) => entry === 'start:a')).toHaveLength(2);
  });

  it('skips a document that is gone or no longer being inspected', async () => {
    const { runner, documents, order } = setup();
    documents.set('b', { id: 'b', status: 'ready', byteLength: 1 });
    documents.delete('c');
    await Promise.all([runner.run('a'), runner.run('b'), runner.run('c')]);
    expect(order).toEqual(['start:a', 'done:a']);
  });

  it('marks a failed read, reports it to the caller and goes on with the next file', async () => {
    const { runner, failures, order, behaviours } = setup();
    behaviours['a'] = async () => {
      throw new Error('Файл повреждён.');
    };
    const failing = runner.run('a');
    const next = runner.run('b');
    await expect(failing).rejects.toThrow('Файл повреждён.');
    await expect(next).resolves.toBeUndefined();
    expect(failures.get('a')).toBe('Файл повреждён.');
    expect(failures.has('b')).toBe(false);
    expect(order).toContain('done:b');
  });

  it('marks a read that stops making progress as failed after the stall time, then reads the next', async () => {
    const { runner, failures, order, behaviours } = setup();
    behaviours['a'] = () => new Promise<void>(() => undefined);
    const stuck = runner.run('a');
    const next = runner.run('b');
    const stuckAssertion = expect(stuck).rejects.toThrow('чтение не продвигалось 60 с');
    await settle();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(failures.size).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    await stuckAssertion;
    expect(failures.get('a')).toContain('«Повторить»');
    await next;
    expect(order).toEqual(['start:a', 'start:b', 'done:b']);
  });

  it('gives a big file more time than a small one', async () => {
    const { runner, failures, behaviours } = setup({ bytes: { a: 5.5 * 1024 * 1024 } });
    behaviours['a'] = () => new Promise<void>(() => undefined);
    const stuck = runner.run('a');
    const assertion = expect(stuck).rejects.toThrow('чтение не продвигалось 93 с');
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(failures.size).toBe(0);
    await vi.advanceTimersByTimeAsync(33_000);
    await assertion;
    expect(failures.has('a')).toBe(true);
  });

  it('keeps a slow read going while it reports progress', async () => {
    const { runner, failures, behaviours } = setup();
    behaviours['a'] = async (progress) => {
      for (let page = 0; page < 6; page += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 30_000));
        progress.touch();
      }
    };
    const reading = runner.run('a');
    await settle();
    await vi.advanceTimersByTimeAsync(180_000);
    await expect(reading).resolves.toBeUndefined();
    expect(failures.size).toBe(0);
  });

  it('stops an abandoned read from writing after the failure was recorded', async () => {
    const { runner, failures, behaviours, order } = setup();
    let wake: () => void = () => undefined;
    behaviours['a'] = () =>
      new Promise<void>((resolve) => {
        wake = resolve;
      });
    const stuck = runner.run('a');
    const assertion = expect(stuck).rejects.toThrow();
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    wake();
    await vi.advanceTimersByTimeAsync(0);
    // The zombie hit assertActive() and never reported "done".
    expect(order).toEqual(['start:a']);
    expect(failures.has('a')).toBe(true);
  });
});
