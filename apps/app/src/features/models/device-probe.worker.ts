/// <reference lib="webworker" />

self.onmessage = (event: MessageEvent<number>): void => {
  const iterations = event.data;
  let value = 0x12345678;
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    value = Math.imul(value ^ index, 2654435761) >>> 0;
  }
  const elapsed = Math.max(1, performance.now() - startedAt);
  self.postMessage(Math.round(iterations / elapsed));
};
