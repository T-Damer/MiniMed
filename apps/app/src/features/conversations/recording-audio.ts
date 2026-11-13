/**
 * Small pure helpers of the recorder (REC1): 16-bit storage of the 16 kHz samples kept for a later
 * «Расшифровать», and the waveform overview the player draws.
 */

export function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index] ?? 0));
    out[index] = value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff);
  }
  return out;
}

export function fromInt16(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] ?? 0;
    out[index] = value < 0 ? value / 0x8000 : value / 0x7fff;
  }
  return out;
}

/**
 * The peaks a waveform of `bars` bars shows: each bar takes the loudest of the peaks it covers.
 * Fewer peaks than bars are spread out, so a short recording still fills the strip.
 */
export function resamplePeaks(peaks: readonly number[], bars: number): number[] {
  if (bars <= 0) return [];
  if (peaks.length === 0) return Array.from({ length: bars }, () => 0);
  const out: number[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    const from = Math.floor((bar * peaks.length) / bars);
    const to = Math.max(from + 1, Math.floor(((bar + 1) * peaks.length) / bars));
    let peak = 0;
    for (let index = from; index < to; index += 1) peak = Math.max(peak, peaks[index] ?? 0);
    out.push(peak);
  }
  return out;
}

/**
 * A peak as the eye reads loudness: speech peaks sit far below full scale, so a square root and a
 * gain spread them over the bar height; a floor keeps silence visible as a thin line.
 */
export function peakHeight(peak: number): number {
  return Math.max(0.06, Math.min(1, Math.sqrt(Math.max(0, peak)) * 1.35));
}

/**
 * Peaks of decoded audio, for a recording that has none stored (made before REC1 or interrupted):
 * one value per `stepSeconds`, rounded so the overview stays small when saved.
 */
export function peaksOfSamples(
  samples: Float32Array,
  sampleRate: number,
  stepSeconds = 0.25,
): number[] {
  const step = Math.max(1, Math.round(sampleRate * stepSeconds));
  const out: number[] = [];
  for (let start = 0; start < samples.length; start += step) {
    let peak = 0;
    const end = Math.min(samples.length, start + step);
    for (let index = start; index < end; index += 4) {
      const value = Math.abs(samples[index] ?? 0);
      if (value > peak) peak = value;
    }
    out.push(Math.round(peak * 1000) / 1000);
  }
  return out;
}
