import type { CoreStatus, MedicalCore } from '@localmed/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  initializeMedicalCore,
  replaceMedicalCore,
  swapMedicalCore,
} from '@/composition/medical-core-lifecycle';
import { RetirableMedicalCore } from '@/composition/retirable-medical-core';

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

  it('swaps the active core before closing the previous instance', async () => {
    const events: string[] = [];
    const currentCore = fakeCore({ ok: true, value: STATUS }, events, { label: 'current' });
    const candidate = fakeCore({ ok: true, value: STATUS }, events, { label: 'candidate' });
    const swapped: MedicalCore[] = [];

    const ready = await swapMedicalCore(
      { core: currentCore, status: STATUS },
      async () => candidate,
      (next) => {
        swapped.push(next.core);
        events.push('swap');
      },
    );

    expect(ready.core).toBe(candidate);
    expect(swapped).toEqual([candidate]);
    expect(events).toEqual(['initialize:candidate', 'swap', 'close:current']);
  });

  describe('reading while a module install swaps the core', () => {
    /** Mirrors sqlite-wasm: any use after close() fails with «DB has been closed». */
    function storeBackedCore(label: string, readDelayMs = 0): MedicalCore {
      let closed = false;
      const read = async (documentId: string) => {
        if (closed) throw new Error('DB has been closed');
        if (readDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, readDelayMs));
        if (closed) throw new Error('DB has been closed');
        return { ok: true, value: { id: documentId, label } };
      };
      return {
        initialize: async () => ({ ok: true, value: STATUS }),
        getDocument: read,
        listDocuments: async () => {
          if (closed) throw new Error('DB has been closed');
          return { ok: true, value: [] };
        },
        close: async () => {
          closed = true;
        },
      } as unknown as MedicalCore;
    }

    it('lets a reader that still holds the previous core open a document during and after the swap', async () => {
      const previous = new RetirableMedicalCore(storeBackedCore('previous', 30));
      const successor = new RetirableMedicalCore(storeBackedCore('successor'));
      const inFlight = previous.getDocument('kr.rf.1_1');

      let readDuringClose: Promise<unknown> | undefined;
      const swapping = swapMedicalCore(
        { core: previous, status: STATUS },
        async () => successor,
        () => {
          // The state already points at the successor, but a reader may still call the old one.
          readDuringClose = previous.getDocument('kr.rf.2_1');
        },
      );
      await swapping;

      await expect(inFlight).resolves.toMatchObject({ value: { label: 'previous' } });
      await expect(readDuringClose).resolves.toMatchObject({ value: { label: 'successor' } });
      await expect(previous.getDocument('kr.rf.3_1')).resolves.toMatchObject({
        value: { label: 'successor' },
      });
      await expect(previous.listDocuments()).resolves.toEqual({ ok: true, value: [] });
    });

    it('closes the replaced core only after its running requests finished', async () => {
      const events: string[] = [];
      const inner = storeBackedCore('previous', 40);
      const originalClose = inner.close.bind(inner);
      inner.close = async () => {
        events.push('inner-closed');
        await originalClose();
      };
      const previous = new RetirableMedicalCore(inner);
      const running = previous.getDocument('kr.rf.1_1').then((result) => {
        events.push('read-finished');
        return result;
      });
      previous.handOverTo(storeBackedCore('successor'));
      await previous.close();
      await running;
      expect(events).toEqual(['read-finished', 'inner-closed']);
    });

    it('does not wait forever for a request that never settles', async () => {
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const stuck = {
        initialize: async () => ({ ok: true, value: STATUS }),
        getDocument: () => new Promise(() => undefined),
        close: vi.fn(async () => undefined),
      } as unknown as MedicalCore;
      const previous = new RetirableMedicalCore(stuck, 20);
      void previous.getDocument('kr.rf.1_1');
      await previous.close();
      expect(stuck.close).toHaveBeenCalledOnce();
      expect(warning).toHaveBeenCalledOnce();
      warning.mockRestore();
    });

    it('closes the wrapped core once and reports a closed core honestly without a successor', async () => {
      const previous = new RetirableMedicalCore(storeBackedCore('only'));
      await Promise.all([previous.close(), previous.close()]);
      await expect(previous.getDocument('kr.rf.1_1')).rejects.toThrow('DB has been closed');
    });
  });
});
