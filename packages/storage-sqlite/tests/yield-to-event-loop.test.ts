import { describe, expect, it } from 'vitest';

import { yieldToEventLoop } from '../src/yield-to-event-loop';

describe('yieldToEventLoop', () => {
  it('resumes after the tasks that were already queued', async () => {
    const order: string[] = [];
    const { port1, port2 } = new MessageChannel();
    const queued = new Promise<void>((resolve) => {
      port1.onmessage = () => {
        order.push('queued');
        resolve();
      };
    });
    port2.postMessage(null);
    await yieldToEventLoop();
    order.push('resumed');
    await queued;
    port1.close();
    port2.close();
    expect(order).toEqual(['queued', 'resumed']);
  });
});
