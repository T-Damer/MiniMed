from __future__ import annotations

import subprocess
from pathlib import Path


models = Path("apps/app/src/features/models")

queue_path = models / "serial-async-queue.ts"
queue_path.write_text(
    """export class SerialAsyncQueue {
  private tail: Promise<void> = Promise.resolve();
  private closed = false;

  public run<T>(task: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Очередь локальной модели закрыта.'));
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  public async close(): Promise<void> {
    this.closed = true;
    await this.tail;
  }
}
""",
    encoding="utf-8",
)

queue_test_path = models / "serial-async-queue.test.ts"
queue_test_path.write_text(
    """import { describe, expect, it } from 'vitest';

import { SerialAsyncQueue } from './serial-async-queue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

describe('SerialAsyncQueue', () => {
  it('runs asynchronous tasks one at a time and preserves order', async () => {
    const queue = new SerialAsyncQueue();
    const first = deferred<string>();
    const events: string[] = [];
    let active = 0;
    let peak = 0;

    const firstRun = queue.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      events.push('first:start');
      const value = await first.promise;
      events.push('first:end');
      active -= 1;
      return value;
    });
    const secondRun = queue.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      events.push('second:start');
      active -= 1;
      return 'second';
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    first.resolve('first');

    await expect(firstRun).resolves.toBe('first');
    await expect(secondRun).resolves.toBe('second');
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
    expect(peak).toBe(1);
  });

  it('continues after a rejected task', async () => {
    const queue = new SerialAsyncQueue();

    await expect(
      queue.run(async () => {
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    await expect(queue.run(async () => 'recovered')).resolves.toBe('recovered');
  });

  it('waits for active work during close and rejects new work', async () => {
    const queue = new SerialAsyncQueue();
    const work = deferred<void>();
    const running = queue.run(() => work.promise);
    const closing = queue.close();

    await expect(queue.run(async () => 'late')).rejects.toThrow('закрыта');
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);

    work.resolve();
    await running;
    await closing;
    expect(closed).toBe(true);
  });
});
""",
    encoding="utf-8",
)

runtime_path = models / "browser-runtime.ts"
runtime = runtime_path.read_text(encoding="utf-8")
import_marker = "} from './types';\n"
if "from './serial-async-queue';" not in runtime:
    runtime = runtime.replace(
        import_marker,
        import_marker + "\nimport { SerialAsyncQueue } from './serial-async-queue';\n",
        1,
    )
class_marker = "class BrowserWllamaSession implements LocalModelSession {\n"
if "private readonly structuredTasks = new SerialAsyncQueue();" not in runtime:
    runtime = runtime.replace(
        class_marker,
        class_marker + "  private readonly structuredTasks = new SerialAsyncQueue();\n\n",
        1,
    )
runtime = runtime.replace(
    "  public async completeStructured(\n    request: LocalModelStructuredRequest,\n  ): Promise<LocalModelStructuredResponse> {\n",
    "  private async runStructured(\n    request: LocalModelStructuredRequest,\n  ): Promise<LocalModelStructuredResponse> {\n",
    1,
)
benchmark_marker = "\n  public async benchmark() {\n"
wrapper = """
  public completeStructured(
    request: LocalModelStructuredRequest,
  ): Promise<LocalModelStructuredResponse> {
    return this.structuredTasks.run(() => this.runStructured(request));
  }
"""
if "return this.structuredTasks.run" not in runtime:
    runtime = runtime.replace(benchmark_marker, "\n" + wrapper + benchmark_marker, 1)
unload_marker = "  public async unload(): Promise<void> {\n"
if "await this.structuredTasks.close();" not in runtime:
    runtime = runtime.replace(
        unload_marker,
        unload_marker + "    await this.structuredTasks.close();\n",
        1,
    )
runtime_path.write_text(runtime, encoding="utf-8")

grounded_path = models / "GroundedMedicalCore.ts"
grounded = grounded_path.read_text(encoding="utf-8")
parallel = """      const [planResponse, rankingResponse] = await Promise.all([
        this.controller.completeStructuredTask({
          task: 'query-plan',
          systemPrompt:
            'Ты модуль планирования медицинского поиска. Не ставь диагноз, не назначай лечение и не добавляй медицинские факты. Верни только JSON по заданной схеме.',
          userPrompt: planPrompt(request.query, deterministic.value.analysis),
          maxTokens: 240,
        }),
        this.controller.completeStructuredTask({
          task: 'rerank',
          systemPrompt:
            'Ты ранжируешь только уже найденные фрагменты медицинских источников. Не создавай новые источники, диагнозы, назначения или дозы. Верни только JSON по заданной схеме.',
          userPrompt: rankingPrompt(request.query, candidates),
          maxTokens: 360,
        }),
      ]);
      if (generation !== this.searchGeneration) return deterministic;
"""
sequential = """      const planResponse = await this.controller.completeStructuredTask({
        task: 'query-plan',
        systemPrompt:
          'Ты модуль планирования медицинского поиска. Не ставь диагноз, не назначай лечение и не добавляй медицинские факты. Верни только JSON по заданной схеме.',
        userPrompt: planPrompt(request.query, deterministic.value.analysis),
        maxTokens: 240,
      });
      if (generation !== this.searchGeneration) return deterministic;
      const rankingResponse = await this.controller.completeStructuredTask({
        task: 'rerank',
        systemPrompt:
          'Ты ранжируешь только уже найденные фрагменты медицинских источников. Не создавай новые источники, диагнозы, назначения или дозы. Верни только JSON по заданной схеме.',
        userPrompt: rankingPrompt(request.query, candidates),
        maxTokens: 360,
      });
      if (generation !== this.searchGeneration) return deterministic;
"""
if parallel not in grounded:
    raise SystemExit("Parallel grounded task block was not found.")
grounded_path.write_text(grounded.replace(parallel, sequential, 1), encoding="utf-8")

subprocess.run(
    [
        "pnpm",
        "exec",
        "biome",
        "format",
        "--write",
        str(queue_path),
        str(queue_test_path),
        str(runtime_path),
        str(grounded_path),
    ],
    check=True,
)
Path(__file__).unlink()
