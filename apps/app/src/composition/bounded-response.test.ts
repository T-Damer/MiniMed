import { describe, expect, it, vi } from 'vitest';
import { readBoundedResponse } from './bounded-response';

describe('readBoundedResponse', () => {
  it('assembles bounded chunks without reading the whole response as an ArrayBuffer', async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4]));
          controller.close();
        },
      }),
    );
    const arrayBuffer = vi.spyOn(response, 'arrayBuffer');
    expect(await readBoundedResponse(response, 4)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(response.body?.locked).toBe(false);
  });
  it('cancels overflow and releases its reader before an OPFS retry', async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(5));
        },
        cancel,
      }),
    );
    expect(await readBoundedResponse(response, 4)).toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });
  it('propagates stream failures and releases the lock', async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('read failed'));
        },
      }),
    );
    await expect(readBoundedResponse(response, 4)).rejects.toThrow('read failed');
    expect(response.body?.locked).toBe(false);
  });
});
