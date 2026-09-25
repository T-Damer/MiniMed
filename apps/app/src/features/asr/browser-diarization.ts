import type { SpeakerRegion } from './speaker-alignment';

export type BrowserDiarizationEngine = (
  audio16k: Float32Array,
) => Promise<readonly SpeakerRegion[]>;

let activeEngine: BrowserDiarizationEngine | null = null;

export function setBrowserDiarizationEngine(engine: BrowserDiarizationEngine | null): void {
  activeEngine = engine;
}

export function isBrowserDiarizationReady(): boolean {
  return activeEngine !== null;
}

export async function diarizeBrowserAudio(
  audio16k: Float32Array,
): Promise<readonly SpeakerRegion[] | null> {
  if (!activeEngine) return null;
  const regions = await activeEngine(audio16k);
  return regions
    .filter(
      (region) =>
        Boolean(region.speakerId) &&
        Number.isFinite(region.startMs) &&
        Number.isFinite(region.endMs) &&
        region.startMs >= 0 &&
        region.endMs > region.startMs,
    )
    .toSorted((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
}
