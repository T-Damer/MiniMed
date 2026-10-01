import type { GlowPalette } from './edge-glow-renderer';

/** Messages from the page to the particle worker. */
export type EdgeGlowWorkerMessage =
  | {
      readonly type: 'init';
      readonly canvas: OffscreenCanvas;
      readonly width: number;
      readonly height: number;
      readonly dpr: number;
      readonly palette: GlowPalette;
    }
  | {
      readonly type: 'resize';
      readonly width: number;
      readonly height: number;
      readonly dpr: number;
    }
  | { readonly type: 'pulse' }
  | { readonly type: 'pause' }
  | { readonly type: 'resume' }
  | { readonly type: 'stop' };
