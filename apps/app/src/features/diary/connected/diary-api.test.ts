import { describe, expect, it } from 'vitest';

import { type DiaryApi, diaryLiveMode } from '@/features/diary/connected/diary-api';

function fakeApi(base: string, answers: (() => unknown)[]): DiaryApi & { calls: number } {
  const api = {
    base,
    calls: 0,
    token: () => undefined,
    async call(_method: string, _path: string, schema: { parse(value: unknown): unknown }) {
      api.calls += 1;
      const answer = answers.shift();
      if (!answer) throw new Error('no more answers');
      return schema.parse(answer());
    },
  };
  return api as unknown as DiaryApi & { calls: number };
}

describe('diary live mode (ADR-0027)', () => {
  it('streams on servers that do not say, polls when the server says so, and asks once', async () => {
    const old = fakeApi('https://old.test', [() => ({ ok: true })]);
    expect(await diaryLiveMode(old)).toBe('sse');
    const serverless = fakeApi('https://api.test', [() => ({ ok: true, live: 'poll' })]);
    expect(await diaryLiveMode(serverless)).toBe('poll');
    expect(await diaryLiveMode(serverless)).toBe('poll');
    expect(serverless.calls).toBe(1);
  });

  it('asks again after a failed answer', async () => {
    const api = fakeApi('https://flaky.test', [
      () => {
        throw new Error('offline');
      },
      () => ({ ok: true, live: 'sse' }),
    ]);
    await expect(diaryLiveMode(api)).rejects.toThrow('offline');
    expect(await diaryLiveMode(api)).toBe('sse');
  });
});
