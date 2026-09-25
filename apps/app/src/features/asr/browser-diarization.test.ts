import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  diarizeBrowserAudio,
  isBrowserDiarizationReady,
  setBrowserDiarizationEngine,
} from './browser-diarization';

describe('browser diarization engine seam', () => {
  afterEach(() => {
    setBrowserDiarizationEngine(null);
  });

  it('returns null when no optional diarizer is active', async () => {
    expect(isBrowserDiarizationReady()).toBe(false);
    await expect(diarizeBrowserAudio(new Float32Array([0, 0.1]))).resolves.toBeNull();
  });

  it('sorts and validates regions returned by the active engine', async () => {
    const engine = vi.fn().mockResolvedValue([
      { speakerId: 'speaker-2', startMs: 900, endMs: 1_400 },
      { speakerId: '', startMs: 0, endMs: 100 },
      { speakerId: 'speaker-1', startMs: 0, endMs: 800 },
      { speakerId: 'bad', startMs: 500, endMs: 400 },
    ]);
    setBrowserDiarizationEngine(engine);

    const audio = new Float32Array([0, 0.2, -0.2]);
    await expect(diarizeBrowserAudio(audio)).resolves.toEqual([
      { speakerId: 'speaker-1', startMs: 0, endMs: 800 },
      { speakerId: 'speaker-2', startMs: 900, endMs: 1_400 },
    ]);
    expect(engine).toHaveBeenCalledWith(audio);
    expect(isBrowserDiarizationReady()).toBe(true);
  });
});
