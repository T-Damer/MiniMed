import { describe, expect, it, vi } from 'vitest';

import { createMemorySkinHistory } from '@/features/skin/skin-history';
import type { SkinModel } from '@/features/skin/skin-model';
import { createFakeSkinModel } from '@/features/skin/skin-model-fake';
import { createSkinSession } from '@/features/skin/skin-session';

const photo = (size = 100): Blob => new Blob([new Uint8Array(size)]);

function setup(model: SkinModel = createFakeSkinModel(0)) {
  const history = createMemorySkinHistory();
  let id = 0;
  const session = createSkinSession({
    model,
    history,
    storedImages: async (blob) => ({ photo: blob, thumbnail: blob }),
    newId: () => `entry-${++id}`,
    now: () => 1_000,
    minScanMs: 0,
    rerankDebounceMs: 5,
  });
  return { session, history };
}

const settle = (ms = 40): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('a sitting with the tool', () => {
  it('takes a photo, ranks it and keeps it in the gallery', async () => {
    const { session, history } = setup();
    await session.init();
    expect(session.state().modelStatus).toBe('ready');
    session.setPhoto(photo());
    expect(session.state().phase).toBe('captured');
    await session.analyze();
    expect(session.state().phase).toBe('result');
    expect(session.state().analysis?.predictions.length).toBeGreaterThan(0);
    const [saved] = await history.list();
    expect(saved?.id).toBe(session.state().entryId);
    expect(saved?.results?.predictions.length).toBeGreaterThan(0);
  });

  it('re-ranks in place when details change and updates the same entry', async () => {
    const { session, history } = setup();
    await session.init();
    session.setPhoto(photo(321));
    await session.analyze();
    const before = session.state().analysis;
    session.setChips({ sites: ['arm', 'hand', 'foot'], duration: 'gt_year' });
    await settle();
    const after = session.state().analysis;
    expect(after).not.toBe(before);
    expect(session.state().phase).toBe('result');
    const entries = await history.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.details.duration).toBe('gt_year');
  });

  it('does not re-rank for details that equal the ranked ones', async () => {
    const model = createFakeSkinModel(0);
    const analyze = vi.spyOn(model, 'analyze');
    const { session } = setup(model);
    await session.init();
    session.setPhoto(photo());
    session.setChips({ sites: ['arm'] });
    await session.analyze();
    session.setChips({ sites: ['arm'] });
    await settle();
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it('puts the patient age and sex into the details and the entry', async () => {
    const model = createFakeSkinModel(0);
    const analyze = vi.spyOn(model, 'analyze');
    const { session, history } = setup(model);
    await session.init();
    session.setPhoto(photo());
    await session.analyze();
    session.setPatient('p1', { age: '40_49', sex: 'female' });
    await settle();
    expect(analyze).toHaveBeenLastCalledWith(expect.anything(), { age: '40_49', sex: 'female' });
    expect((await history.list())[0]?.patientId).toBe('p1');
  });

  it('drops the answer of a run the user retook over', async () => {
    const { session, history } = setup(createFakeSkinModel(30));
    await session.init();
    session.setPhoto(photo());
    const running = session.analyze();
    expect(session.state().phase).toBe('scanning');
    session.retake();
    await running;
    expect(session.state().phase).toBe('idle');
    expect(session.state().analysis).toBeUndefined();
    expect(await history.list()).toEqual([]);
  });

  it('keeps the photo and says nothing is ranked when the model is missing', async () => {
    const { session, history } = setup({
      status: async () => 'missing',
      analyze: async () => {
        throw new Error('not installed');
      },
    });
    await session.init();
    expect(session.state().modelStatus).toBe('missing');
    session.setPhoto(photo());
    await session.analyze();
    expect(session.state()).toMatchObject({ phase: 'result', analysis: undefined, failed: false });
    const [saved] = await history.list();
    expect(saved).toBeDefined();
    expect(saved?.results).toBeUndefined();
  });

  it('reports a failing model as a failed run, not a crash, and recovers on the next change', async () => {
    let calls = 0;
    const model: SkinModel = {
      status: async () => 'ready',
      analyze: async (blob, details) => {
        calls += 1;
        if (calls === 1) throw new Error('worker died');
        return createFakeSkinModel(0).analyze(blob, details);
      },
    };
    const errors: unknown[] = [];
    const history = createMemorySkinHistory();
    const session = createSkinSession({
      model,
      history,
      storedImages: async (blob) => ({ photo: blob, thumbnail: blob }),
      minScanMs: 0,
      rerankDebounceMs: 5,
      onError: (cause) => errors.push(cause),
    });
    await session.init();
    session.setPhoto(photo());
    await session.analyze();
    expect(session.state()).toMatchObject({ phase: 'result', failed: true });
    expect(errors).toHaveLength(1);
    session.setChips({ sites: ['leg'] });
    await settle();
    expect(session.state().failed).toBe(false);
    expect(session.state().analysis).toBeDefined();
  });

  it('starts the next photo without the previous result', async () => {
    const { session } = setup();
    await session.init();
    session.setPhoto(photo());
    await session.analyze();
    session.setPhoto(photo(999));
    expect(session.state()).toMatchObject({
      phase: 'captured',
      analysis: undefined,
      entryId: undefined,
    });
  });
});
