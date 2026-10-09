/**
 * Lets the messages already queued on this thread run before the caller continues. A message
 * channel is a task like a worker's incoming messages and, unlike `setTimeout`, is not clamped to
 * 4 ms after a few nested turns; a thread without one falls back to a timer.
 */
export function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel === 'undefined') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      port2.close();
      resolve();
    };
    port2.postMessage(null);
  });
}
