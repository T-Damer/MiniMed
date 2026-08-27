import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { allowLocalModels: true },
  pipeline: vi.fn(),
}));

vi.mock('@huggingface/transformers', () => mocks);

interface WorkerScopeMock {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
}

describe('ASR worker model loading', () => {
  let scope: WorkerScopeMock;

  beforeEach(() => {
    vi.resetModules();
    mocks.pipeline.mockReset();
    scope = { onmessage: null, postMessage: vi.fn() };
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
