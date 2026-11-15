import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTimeSlicer } from './time-slice';
import { buildNameVocabulary, buildNameVocabularySliced } from './word-typo';

describe('createTimeSlicer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not wait while the piece is within its budget', () => {
    vi.spyOn(performance, 'now').mockReturnValue(100);
    expect(createTimeSlicer(8)()).toBeUndefined();
  });

  it('waits for the next task once the budget is used, then starts a new piece', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(100);
    const slice = createTimeSlicer(8);
    now.mockReturnValue(109);
    const due = slice();
    expect(due).toBeInstanceOf(Promise);
    await due;
    expect(slice()).toBeUndefined();
  });
});

describe('buildNameVocabularySliced', () => {
  it('builds the same vocabulary as the one-piece builder, also when it yields after every name', async () => {
    const names = ['пневмония внебольничная', 'пневмония у детей', 'амоксициллин', 'j18 пневмония'];
    const expected = buildNameVocabulary(names);
    const always = (): Promise<void> => Promise.resolve();
    const sliced = await buildNameVocabularySliced(names, always);
    expect(sliced.words).toEqual(expected.words);
    expect([...sliced.weights]).toEqual([...expected.weights]);
  });
});
