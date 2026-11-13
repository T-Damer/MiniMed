import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { allowLocalModels: true, fetch: vi.fn<typeof fetch>() },
  pipeline: vi.fn(),
}));

vi.mock('@huggingface/transformers', () => mocks);

import { ASR_MODEL_REVISIONS } from './asr-download-protocol';

interface WorkerScopeMock {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  location: { readonly href: string };
}

describe('ASR worker model loading', () => {
  let scope: WorkerScopeMock;

  beforeEach(() => {
    vi.resetModules();
    mocks.pipeline.mockReset();
    mocks.env.fetch = vi.fn<typeof fetch>().mockResolvedValue(new Response('fallback'));
    scope = {
      onmessage: null,
      postMessage: vi.fn(),
      location: { href: 'https://minimed.test/app/' },
    };
    vi.stubGlobal('self', scope);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function loadModel(): Promise<void> {
    await import('./asr.worker');
    scope.onmessage?.({
      data: { type: 'load', modelId: 'onnx-community/whisper-base' },
    } as MessageEvent);
  }

  it('pins the model revision passed to transformers.js', async () => {
    mocks.pipeline.mockResolvedValue(vi.fn());

    await loadModel();
    await vi.waitFor(() => {
      expect(scope.postMessage).toHaveBeenCalledWith({
        type: 'ready',
        modelId: 'onnx-community/whisper-base',
      });
    });

    expect(mocks.pipeline).toHaveBeenCalledWith(
      'automatic-speech-recognition',
      'onnx-community/whisper-base',
      expect.objectContaining({
        dtype: 'q8',
        revision: ASR_MODEL_REVISIONS['onnx-community/whisper-base'],
      }),
    );
  });

  it('reports monotonic total progress instead of per-file percentages', async () => {
    mocks.pipeline.mockImplementation(async (_task, _modelId, options) => {
      options.progress_callback({ status: 'progress_total', progress: 60 });
      options.progress_callback({ status: 'progress', progress: 90 });
      options.progress_callback({ status: 'progress_total', progress: 65 });
      options.progress_callback({ status: 'progress', progress: 10 });
      return vi.fn();
    });

    await loadModel();
    await vi.waitFor(() => {
      expect(scope.postMessage).toHaveBeenCalledWith({
        type: 'ready',
        modelId: 'onnx-community/whisper-base',
      });
    });

    expect(
      scope.postMessage.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === 'loading')
        .map((message) => message.progress),
    ).toEqual([0, 0.6, 0.65]);
  });

  it('returns timestamp chunks as local transcript segments', async () => {
    const transcribe = vi.fn().mockResolvedValue({
      text: 'Первая фраза. Вторая фраза.',
      chunks: [
        { timestamp: [0, 1.25], text: ' Первая фраза. ' },
        { timestamp: [1.25, 2.5], text: 'Вторая фраза.' },
        { timestamp: [2.5, null], text: 'Незавершённый chunk' },
      ],
    });
    mocks.pipeline.mockResolvedValue(transcribe);

    await loadModel();
    await vi.waitFor(() => {
      expect(scope.postMessage).toHaveBeenCalledWith({
        type: 'ready',
        modelId: 'onnx-community/whisper-base',
      });
    });

    scope.onmessage?.({
      data: {
        type: 'transcribe',
        requestId: 'request-1',
        modelId: 'onnx-community/whisper-base',
        audio: new Float32Array([0, 0.1, -0.1]),
      },
    } as MessageEvent);

    await vi.waitFor(() => {
      expect(scope.postMessage).toHaveBeenCalledWith({
        type: 'result',
        requestId: 'request-1',
        text: 'Первая фраза. Вторая фраза.',
        segments: [
          {
            speakerId: 'speaker-1',
            startMs: 0,
            endMs: 1250,
            text: 'Первая фраза.',
          },
          {
            speakerId: 'speaker-1',
            startMs: 1250,
            endMs: 2500,
            text: 'Вторая фраза.',
          },
        ],
      });
    });

    expect(transcribe).toHaveBeenCalledWith(
      expect.any(Float32Array),
      expect.objectContaining({
        language: 'russian',
        task: 'transcribe',
        return_timestamps: 'word',
      }),
    );
  });

  it('reads a conversation stretch in one pass and remembers a failing timestamp mode', async () => {
    const transcribe = vi.fn(async (_audio: Float32Array, options: Record<string, unknown>) => {
      if (options['return_timestamps'] === 'word') {
        throw new Error('Model outputs must contain cross attentions to extract timestamps.');
      }
      return { text: 'Текст.' };
    });
    mocks.pipeline.mockResolvedValue(transcribe);
    await loadModel();
    await vi.waitFor(() => {
      expect(scope.postMessage).toHaveBeenCalledWith({
        type: 'ready',
        modelId: 'onnx-community/whisper-base',
      });
    });
    const ask = (requestId: string, timestamps?: boolean) =>
      scope.onmessage?.({
        data: {
          type: 'transcribe',
          requestId,
          modelId: 'onnx-community/whisper-base',
          audio: new Float32Array([0, 0.1]),
          ...(timestamps === undefined ? {} : { timestamps }),
        },
      } as MessageEvent);

    // A live stretch: text only, one decoding pass.
    ask('live-1', false);
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1));
    expect(transcribe.mock.calls[0]?.[1]).toMatchObject({ return_timestamps: false });

    // A file: word timestamps fail once, segment timestamps work and are used from then on.
    ask('file-1');
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(3));
    ask('file-2');
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(4));
    expect(transcribe.mock.calls[3]?.[1]).toMatchObject({ return_timestamps: true });
  });

  it('accepts a pinned Hugging Face Request and preserves its Range metadata', async () => {
    await import('./asr.worker');
    const revision = ASR_MODEL_REVISIONS['onnx-community/whisper-base'];
    const url = `https://huggingface.co/onnx-community/whisper-base/resolve/${revision}/config.json`;
    const pending = mocks.env.fetch(
      new Request(url, {
        headers: { Range: 'bytes=0-0' },
      }),
    );

    await vi.waitFor(() => {
      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'fetch-asset',
          modelId: 'onnx-community/whisper-base',
          url,
          metadataOnly: true,
        }),
      );
    });
    const request = scope.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message.type === 'fetch-asset');
    expect(request).toBeTruthy();

    scope.onmessage?.({
      data: {
        type: 'asset-response',
        requestId: request.requestId,
        status: 206,
        headers: [['content-range', 'bytes 0-0/10']],
        bytes: null,
      },
    } as MessageEvent);

    const response = await pending;
    expect(response.status).toBe(206);
  });

  it('serves the transformers 4 `main` config probe from the pinned revision', async () => {
    await import('./asr.worker');
    const revision = ASR_MODEL_REVISIONS['onnx-community/whisper-base'];
    void mocks.env.fetch(
      'https://huggingface.co/onnx-community/whisper-base/resolve/main/tokenizer_config.json',
      { headers: { Range: 'bytes=0-0' } },
    );

    await vi.waitFor(() => {
      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'fetch-asset',
          url: `https://huggingface.co/onnx-community/whisper-base/resolve/${revision}/tokenizer_config.json`,
          metadataOnly: true,
        }),
      );
    });
  });

  it('rejects non-GET Request inputs before they can leave the worker', async () => {
    await import('./asr.worker');
    const revision = ASR_MODEL_REVISIONS['onnx-community/whisper-base'];
    const url = `https://huggingface.co/onnx-community/whisper-base/resolve/${revision}/config.json`;

    await expect(
      mocks.env.fetch(
        new Request(url, {
          method: 'POST',
          body: 'unexpected',
        }),
      ),
    ).rejects.toThrow('Unsupported speech download.');
    expect(scope.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'fetch-asset' }),
    );
  });

  it('rejects unsupported Request Range headers', async () => {
    await import('./asr.worker');
    const revision = ASR_MODEL_REVISIONS['onnx-community/whisper-base'];
    const url = `https://huggingface.co/onnx-community/whisper-base/resolve/${revision}/config.json`;

    await expect(
      mocks.env.fetch(
        new Request(url, {
          headers: { Range: 'bytes=1-2' },
        }),
      ),
    ).rejects.toThrow('Unsupported speech metadata range.');
  });

  it('retries a temporary network error before failing the model load', async () => {
    vi.useFakeTimers();
    mocks.pipeline
      .mockRejectedValueOnce(new TypeError('Network error'))
      .mockResolvedValueOnce(vi.fn());

    await loadModel();
    await vi.runAllTimersAsync();

    expect(mocks.pipeline).toHaveBeenCalledTimes(2);
    expect(scope.postMessage).toHaveBeenCalledWith({
      type: 'ready',
      modelId: 'onnx-community/whisper-base',
    });
  });
});
