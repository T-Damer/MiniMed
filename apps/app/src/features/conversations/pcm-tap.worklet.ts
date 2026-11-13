/**
 * The recorder's tap on the microphone, on the audio thread (REC1). It turns the live signal into
 * what the rest of the app needs without ever decoding the recorded file: mono 16 kHz samples for
 * speech recognition and one peak per 50 ms for the waveform, posted in small batches. The main
 * thread receives 20 short messages a second and does no audio arithmetic itself.
 *
 * A context that already runs at 16 kHz (the recorder asks for one; Chromium resamples the
 * microphone properly) passes samples through. Any higher rate is brought down by a box filter that
 * averages the source samples of each output step — the fallback, enough for speech.
 */

const TARGET_RATE = 16_000;
/** Samples per posted batch: 800 at 16 kHz = 50 ms, the waveform's step. */
const BATCH = 800;

interface TapMessage {
  readonly type: 'pcm';
  readonly samples: Float32Array;
  readonly peak: number;
}

declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class PcmTapProcessor extends AudioWorkletProcessor {
  private readonly ratio = Math.max(1, sampleRate / TARGET_RATE);
  /** Source samples taken into the current output step, and their sum. */
  private position = 0;
  private sum = 0;
  private count = 0;
  private batch = new Float32Array(BATCH);
  private filled = 0;
  private peak = 0;
  private paused = false;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<{ readonly type: string }>) => {
      if (event.data.type === 'pause') this.paused = true;
      if (event.data.type === 'resume') this.paused = false;
    };
  }

  private push(sample: number): void {
    this.batch[this.filled] = sample;
    this.filled += 1;
    const magnitude = sample < 0 ? -sample : sample;
    if (magnitude > this.peak) this.peak = magnitude;
    if (this.filled === BATCH) {
      const message: TapMessage = { type: 'pcm', samples: this.batch, peak: this.peak };
      this.port.postMessage(message, [this.batch.buffer]);
      this.batch = new Float32Array(BATCH);
      this.filled = 0;
      this.peak = 0;
    }
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel || this.paused) return true;
    if (this.ratio === 1) {
      for (let index = 0; index < channel.length; index += 1) this.push(channel[index] ?? 0);
      return true;
    }
    for (let index = 0; index < channel.length; index += 1) {
      this.sum += channel[index] ?? 0;
      this.count += 1;
      this.position += 1;
      if (this.position >= this.ratio) {
        this.push(this.sum / this.count);
        this.sum = 0;
        this.count = 0;
        this.position -= this.ratio;
      }
    }
    return true;
  }
}

registerProcessor('minimed-pcm-tap', PcmTapProcessor);
