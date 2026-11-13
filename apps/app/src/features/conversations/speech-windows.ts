/**
 * Cuts a stream of 16 kHz mono samples into stretches of speech for the recogniser (REC1). Before,
 * the recording was cut every 7 s wherever the clock fell — through the middle of words, which the
 * model then misheard on both sides — and long silences went to the model whole, where Whisper
 * «hears» subtitles credits. Here a small energy detector marks 30 ms frames as speech or not, and
 * a stretch ends in a pause: after `minSeconds` at the first pause of `cutPauseSeconds`, at once
 * after a long pause (`endPauseSeconds`), and at the quietest moment of its last seconds when it
 * reaches `maxSeconds` without one. Leading silence is dropped (a short pre-roll stays) and the
 * tail is trimmed to just after the last speech.
 *
 * Positions are absolute sample indices since the start of the recording, so each stretch keeps its
 * place in time for the transcript's timings and the player.
 */

export const SPEECH_SAMPLE_RATE = 16_000;
/** 30 ms. */
export const SPEECH_FRAME = 480;

export interface SpeechWindowOptions {
  readonly minSeconds: number;
  readonly maxSeconds: number;
  readonly cutPauseSeconds: number;
  readonly endPauseSeconds: number;
  readonly preRollSeconds: number;
  readonly tailSeconds: number;
  /** A frame quieter than this (RMS of −50 dBFS) is never speech. */
  readonly absoluteFloor: number;
  /** A frame is speech when it is this many times louder than the tracked background. */
  readonly overNoise: number;
}

export const DEFAULT_SPEECH_WINDOWS: SpeechWindowOptions = {
  minSeconds: 8,
  maxSeconds: 24,
  cutPauseSeconds: 0.45,
  endPauseSeconds: 1.4,
  preRollSeconds: 0.3,
  tailSeconds: 0.3,
  absoluteFloor: 0.003,
  overNoise: 3,
};

export interface SpeechWindow {
  /** Absolute index of the first sample. */
  readonly startSample: number;
  readonly samples: Float32Array;
  /** How much of it the detector took for speech; a stretch with almost none is not worth reading. */
  readonly speechSeconds: number;
}

interface Frame {
  readonly samples: Float32Array;
  readonly rms: number;
  readonly speech: boolean;
}

function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function framesFor(seconds: number): number {
  return Math.max(1, Math.round((seconds * SPEECH_SAMPLE_RATE) / SPEECH_FRAME));
}

export class SpeechSegmenter {
  private readonly options: SpeechWindowOptions;
  private frames: Frame[] = [];
  /** Absolute sample index of `frames[0]`. */
  private start = 0;
  private partial = new Float32Array(SPEECH_FRAME);
  private partialLength = 0;
  private noise = 0;

  constructor(options: Partial<SpeechWindowOptions> = {}, startSample = 0) {
    this.options = { ...DEFAULT_SPEECH_WINDOWS, ...options };
    this.start = startSample;
  }

  /** Absolute index of the first sample not yet handed out or dropped as silence. */
  get position(): number {
    return this.start;
  }

  /** Seconds held back waiting for a pause. */
  get bufferedSeconds(): number {
    return (this.frames.length * SPEECH_FRAME + this.partialLength) / SPEECH_SAMPLE_RATE;
  }

  /** Takes the next samples; returns the stretches that ended in them. */
  push(samples: Float32Array): SpeechWindow[] {
    const out: SpeechWindow[] = [];
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(SPEECH_FRAME - this.partialLength, samples.length - offset);
      this.partial.set(samples.subarray(offset, offset + take), this.partialLength);
      this.partialLength += take;
      offset += take;
      if (this.partialLength === SPEECH_FRAME) {
        this.addFrame(this.partial);
        this.partial = new Float32Array(SPEECH_FRAME);
        this.partialLength = 0;
        const window = this.check();
        if (window) out.push(window);
      }
    }
    return out;
  }

  /** The end of the recording: whatever speech is held goes out, however short. */
  flush(): SpeechWindow | null {
    if (this.partialLength > 0) {
      this.addFrame(this.partial.slice(0, this.partialLength));
      this.partial = new Float32Array(SPEECH_FRAME);
      this.partialLength = 0;
    }
    const last = this.lastSpeech();
    if (last < 0) {
      this.drop(this.frames.length);
      return null;
    }
    const window = this.cut(
      Math.min(this.frames.length, last + 1 + framesFor(this.options.tailSeconds)),
    );
    // The end of the recording: silence after the last words is done too.
    this.drop(this.frames.length);
    return window;
  }

  private addFrame(samples: Float32Array): void {
    const rms = rmsOf(samples);
    // The background starts at the floor: a recording may begin mid-sentence.
    if (this.noise === 0) this.noise = this.options.absoluteFloor;
    const speech = rms > Math.max(this.options.absoluteFloor, this.noise * this.options.overNoise);
    // The background follows quiet frames quickly and creeps up slowly, so a louder room is
    // learned within seconds while speech itself barely moves it.
    if (rms < this.noise) this.noise = this.noise * 0.7 + rms * 0.3;
    else this.noise = Math.min(rms, this.noise * 1.003);
    this.frames.push({ samples, rms, speech });
  }

  private lastSpeech(): number {
    for (let index = this.frames.length - 1; index >= 0; index -= 1) {
      if (this.frames[index]?.speech) return index;
    }
    return -1;
  }

  private check(): SpeechWindow | null {
    const first = this.frames.findIndex((frame) => frame.speech);
    if (first < 0) {
      const keep = framesFor(this.options.preRollSeconds);
      if (this.frames.length > keep) this.drop(this.frames.length - keep);
      return null;
    }
    const preRoll = framesFor(this.options.preRollSeconds);
    if (first > preRoll) this.drop(first - preRoll);

    const last = this.lastSpeech();
    const length = this.frames.length;
    const pause = length - 1 - last;
    const seconds = (length * SPEECH_FRAME) / SPEECH_SAMPLE_RATE;
    const tail = framesFor(this.options.tailSeconds);
    if (pause >= framesFor(this.options.endPauseSeconds)) return this.cut(last + 1 + tail);
    if (seconds >= this.options.minSeconds && pause >= framesFor(this.options.cutPauseSeconds)) {
      return this.cut(last + 1 + Math.min(tail, Math.floor(pause / 2)));
    }
    if (seconds >= this.options.maxSeconds) return this.cut(this.quietestRecentFrame() + 1);
    return null;
  }

  /** The end of the quietest 150 ms in the last 4 s: the least harmful place to cut a monologue. */
  private quietestRecentFrame(): number {
    const run = 5;
    const from = Math.max(run, this.frames.length - framesFor(4));
    let best = this.frames.length - 1;
    let bestEnergy = Number.POSITIVE_INFINITY;
    for (let end = from; end < this.frames.length; end += 1) {
      let energy = 0;
      for (let index = end - run + 1; index <= end; index += 1) {
        energy += this.frames[index]?.rms ?? 0;
      }
      if (energy < bestEnergy) {
        bestEnergy = energy;
        best = end;
      }
    }
    return best;
  }

  private cut(endFrame: number): SpeechWindow {
    const frames = this.frames.slice(0, endFrame);
    const total = frames.reduce((sum, frame) => sum + frame.samples.length, 0);
    const samples = new Float32Array(total);
    let at = 0;
    let speechFrames = 0;
    for (const frame of frames) {
      samples.set(frame.samples, at);
      at += frame.samples.length;
      if (frame.speech) speechFrames += 1;
    }
    const window: SpeechWindow = {
      startSample: this.start,
      samples,
      speechSeconds: (speechFrames * SPEECH_FRAME) / SPEECH_SAMPLE_RATE,
    };
    this.drop(endFrame);
    return window;
  }

  private drop(count: number): void {
    const dropped = this.frames.splice(0, count);
    for (const frame of dropped) this.start += frame.samples.length;
  }
}
