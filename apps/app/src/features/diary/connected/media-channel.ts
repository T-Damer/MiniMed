import { z } from 'zod';

const MIB = 1024 * 1024;
const MAX_TOTAL = 48 * MIB;
const CHUNK_SIZE = 16 * 1024;
const BUFFER_LIMIT = 256 * 1024;
const DATA_CHANNEL = 'signum-media-v1';

const mediaTypes = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
} as const;
const fileType = z.custom<keyof typeof mediaTypes>(
  (type) => typeof type === 'string' && Object.hasOwn(mediaTypes, type),
);
const selection = z
  .array(
    z
      .object({
        type: fileType,
        size: z
          .number()
          .int()
          .positive()
          .max(32 * MIB),
      })
      .strict(),
  )
  .min(1)
  .max(8)
  .refine((files) => files.reduce((total, file) => total + file.size, 0) <= MAX_TOTAL);
type Selection = z.infer<typeof selection>;
type Progress = (done: number, total: number) => void;

export const mediaAccept = Object.keys(mediaTypes).join(',');
export function mediaSelectionValid(files: readonly File[]): boolean {
  return selection.safeParse(describeFiles(files)).success;
}

function describeFiles(files: readonly File[]) {
  return files.map(({ type, size }) => ({ type, size }));
}

export interface ReceivedMedia {
  readonly blob: Blob;
  readonly name: string;
}

type Failure = 'closed' | 'protocol' | 'connection';
export class MediaChannelError extends Error {
  constructor(readonly kind: Failure) {
    super(kind);
  }
}

function until(
  target: EventTarget,
  event: string,
  ready: () => boolean,
  signal: AbortSignal,
  ms: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new MediaChannelError('closed'));
      return;
    }
    if (ready()) {
      resolve();
      return;
    }
    const clear = () => {
      target.removeEventListener(event, changed);
      signal.removeEventListener('abort', aborted);
      clearTimeout(timer);
    };
    const changed = () => {
      if (ready()) {
        clear();
        resolve();
      }
    };
    const aborted = () => {
      clear();
      reject(new MediaChannelError('closed'));
    };
    const timer = setTimeout(() => {
      clear();
      reject(new MediaChannelError('connection'));
    }, ms);
    target.addEventListener(event, changed);
    signal.addEventListener('abort', aborted, { once: true });
  });
}

/** The signaling API never sees a frame. A reliable, ordered WebRTC channel carries file bytes. */
export class DiaryMediaPeer {
  private readonly peer: RTCPeerConnection;
  private readonly stop = new AbortController();
  private onFailure?: () => void;

  constructor(config: RTCConfiguration) {
    this.peer = new RTCPeerConnection(config);
    this.peer.addEventListener('connectionstatechange', () => {
      if (this.peer.connectionState === 'failed') {
        this.onFailure?.();
        this.close();
      }
    });
  }

  close(): void {
    this.stop.abort();
    this.peer.close();
  }

  private async local(description: RTCSessionDescriptionInit): Promise<string> {
    await this.peer.setLocalDescription(description);
    await until(
      this.peer,
      'icegatheringstatechange',
      () => this.peer.iceGatheringState === 'complete',
      this.stop.signal,
      12_000,
    );
    const sdp = this.peer.localDescription?.sdp;
    if (!sdp) throw new MediaChannelError('connection');
    return sdp;
  }

  async offer(
    progress: Progress,
    received: (files: readonly ReceivedMedia[]) => void,
    failed: () => void,
  ): Promise<string> {
    const channel = this.peer.createDataChannel(DATA_CHANNEL);
    channel.binaryType = 'arraybuffer';
    let manifest: Selection | undefined;
    let frames: ArrayBuffer[] = [];
    let size = 0;
    let done = 0;
    let total = 0;
    let complete = false;
    this.onFailure = () => {
      if (!complete) failed();
    };
    const files: ReceivedMedia[] = [];
    channel.addEventListener('open', () => progress(0, 0));
    channel.addEventListener('close', () => {
      if (!complete && !this.stop.signal.aborted) failed();
    });
    channel.addEventListener('message', ({ data }: MessageEvent<unknown>) => {
      try {
        if (complete) return;
        if (!manifest && typeof data === 'string' && data.length <= 1024) {
          manifest = selection.parse(JSON.parse(data));
          total = manifest.reduce((sum, file) => sum + file.size, 0);
          progress(0, total);
          return;
        }
        if (data === 'done' && manifest && files.length === manifest.length) {
          complete = true;
          channel.send('received');
          received(files);
          return;
        }
        const file = manifest?.[files.length];
        if (
          !file ||
          !(data instanceof ArrayBuffer) ||
          !data.byteLength ||
          data.byteLength > CHUNK_SIZE ||
          size + data.byteLength > file.size
        )
          throw new MediaChannelError('protocol');
        size += data.byteLength;
        done += data.byteLength;
        frames.push(data);
        if (size === file.size) {
          files.push({
            blob: new Blob(frames, { type: file.type }),
            name: `signum-${files.length + 1}.${mediaTypes[file.type]}`,
          });
          frames = [];
          size = 0;
        }
        progress(done, total);
      } catch {
        failed();
        this.close();
      }
    });
    return this.local(await this.peer.createOffer());
  }

  async accept(sdp: string): Promise<void> {
    await this.peer.setRemoteDescription({ type: 'answer', sdp });
  }

  async send(
    offer: string,
    files: readonly File[],
    publishAnswer: (sdp: string) => Promise<void>,
    progress: Progress,
  ): Promise<void> {
    const manifest = selection.parse(describeFiles(files));
    let channel: RTCDataChannel | undefined;
    const gotChannel = new EventTarget();
    this.peer.addEventListener('datachannel', (event) => {
      if (channel || event.channel.label !== DATA_CHANNEL) {
        event.channel.close();
        return;
      }
      channel = event.channel;
      gotChannel.dispatchEvent(new Event('ready'));
    });
    await this.peer.setRemoteDescription({ type: 'offer', sdp: offer });
    await publishAnswer(await this.local(await this.peer.createAnswer()));
    await until(gotChannel, 'ready', () => channel !== undefined, this.stop.signal, 75_000);
    if (!channel) throw new MediaChannelError('connection');
    await this.sendFiles(channel, files, manifest, progress);
  }

  private async sendFiles(
    channel: RTCDataChannel,
    files: readonly File[],
    manifest: Selection,
    progress: Progress,
  ): Promise<void> {
    channel.addEventListener('close', () => this.close());
    await until(channel, 'open', () => channel.readyState === 'open', this.stop.signal, 75_000);
    channel.bufferedAmountLowThreshold = BUFFER_LIMIT / 2;
    channel.send(JSON.stringify(manifest));
    let done = 0;
    const total = manifest.reduce((sum, file) => sum + file.size, 0);
    for (const file of files) {
      for (let start = 0; start < file.size; start += CHUNK_SIZE) {
        if (channel.bufferedAmount > BUFFER_LIMIT) {
          await until(
            channel,
            'bufferedamountlow',
            () => channel.bufferedAmount <= channel.bufferedAmountLowThreshold,
            this.stop.signal,
            20_000,
          );
        }
        const data = await file.slice(start, start + CHUNK_SIZE).arrayBuffer();
        channel.send(data);
        done += data.byteLength;
        progress(done, total);
      }
    }
    let confirmed = false;
    channel.addEventListener('message', ({ data }) => {
      if (data === 'received') confirmed = true;
    });
    channel.send('done');
    await until(channel, 'message', () => confirmed, this.stop.signal, 20_000);
  }
}
