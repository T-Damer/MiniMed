/// <reference lib="webworker" />

import { EdgeGlowEngine } from './edge-glow-engine';
import type { EdgeGlowWorkerMessage } from './edge-glow-protocol';
import type { GlowCanvasContext } from './edge-glow-renderer';

/**
 * Particles for the tour's edge glow, drawn on an OffscreenCanvas so the page's thread (scrolling,
 * the card, the arrows) never waits for them.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;
let engine: EdgeGlowEngine | undefined;

const schedule = (callback: () => void): number =>
  typeof scope.requestAnimationFrame === 'function'
    ? scope.requestAnimationFrame(callback)
    : scope.setTimeout(callback, 16);
const cancel = (handle: number): void => {
  if (typeof scope.cancelAnimationFrame === 'function') scope.cancelAnimationFrame(handle);
  else scope.clearTimeout(handle);
};

scope.addEventListener('message', (event: MessageEvent<EdgeGlowWorkerMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'init': {
      const context = message.canvas.getContext('2d');
      if (!context) throw new Error('Не удалось получить 2D-контекст для свечения.');
      engine = new EdgeGlowEngine(
        { canvas: message.canvas, context: context as unknown as GlowCanvasContext },
        message.palette,
        schedule,
        cancel,
        () => performance.now(),
      );
      engine.resize(message.width, message.height, message.dpr);
      return;
    }
    case 'resize':
      engine?.resize(message.width, message.height, message.dpr);
      return;
    case 'pulse':
      engine?.pulse();
      return;
    case 'pause':
      engine?.pause();
      return;
    case 'resume':
      engine?.resume();
      return;
    case 'stop':
      engine?.stop();
      engine = undefined;
      scope.close();
      return;
  }
});
