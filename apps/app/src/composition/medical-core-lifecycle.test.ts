import type { CoreStatus, MedicalCore } from '@localmed/contracts';
import { describe, expect, it, vi } from 'vitest';

import { initializeMedicalCore, replaceMedicalCore } from './medical-core-lifecycle';

const STATUS = {
  state: 'ready',
  schemaVersion: 2,
  documentCount: 1,
  contentPackIds: ['test.pack'],
} as CoreStatus;

type InitializationResult = Awaited<ReturnType<MedicalCore['initialize']>>;

function fakeCore(
  result: InitializationResult,
  events: string[],
  options: { readonly closeError?: Error; readonly label: string },
): MedicalCore {
  return {
    initialize: async () => {
      events.push(`initialize:${options.label}`);
      return result;
    },
    close: async () => {
      events.push(`close:${options.label}`);
      if (options.closeError) throw options.closeError;
    },
  } as unknown as MedicalCore;
}

describe('medical core lifecycle', () => {
  it('initializes a new core and returns its status', async () => {
    const events: string[] = [];
    const core = fakeCore({ ok: true, value: STATUS }, events, { label: 'initial' });

    const ready = await initializeMedicalCore(async () => core);

    expect(ready).toEqual({ core, status: STATUS });
    expect(events).toEqual(['initialize:initial']);
  });

  it('closes a failed candidate and keeps the current core untouched', async () => {
    const events: string[] = [];
    const currentCore = fakeCore({ ok: true, value: STATUS }, events, { label: 'current' });
    const candidate = fakeCore(
      { ok: false, error: { message: 'candidate failed' } } as InitializationResult,
      events,
      { label: 'candidate' },
    );

    await expect(
      replaceMedicalCore({ core: currentCore, status: STATUS }, async () => candidate),
    ).rejects.toThrow('candidate failed');

    expect(events).toEqual(['initialize:candidate', 'close:candidate']);
  });

  it('switches only after the candidate initializes and then closes the previous core', async () => {
    const events: string[] = [];
    const currentCore = fakeCore({ ok: true, value: STATUS }, events, { label: 'current' });
    const nextStatus = { ...STATUS, documentCount: 4 };
    const candidate = fakeCore({ ok: true, value: nextStatus }, events, { label: 'candidate' });

    const ready = await replaceMedicalCore(
      { core: currentCore, status: STATUS },
      async () => candidate,
    );

    expect(ready).toEqual({ core: candidate, status: nextStatus });
    expect(events).toEqual(['initialize:candidate', 'close:current']);
  });

  it('keeps the initialized replacement when closing the previous core fails', async () => {
    const events: string[] = [];
    const currentCore = fakeCore({ ok: true, value: STATUS }, events, {
      label: 'current',
      closeError: new Error('close failed'),
    });
    const candidate = fakeCore({ ok: true, value: STATUS }, events, { label: 'candidate' });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const ready = await replaceMedicalCore(
      { core: currentCore, status: STATUS },
      async () => candidate,
    );

    expect(ready.core).toBe(candidate);
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });
});
