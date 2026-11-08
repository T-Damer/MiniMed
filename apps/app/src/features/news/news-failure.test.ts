import { ERROR_ACTION_LABELS } from '@localmed/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FeedParseError } from '@/features/news/feed-parser';
import {
  attemptFeed,
  attemptSubscribe,
  FEED_FAILURE_STATES,
  failureFromCode,
  failureLine,
  failureProps,
  failureState,
  feedFailureOf,
  SUBSCRIBE_FAILURE_STATES,
  SubscribeRefusal,
  subscribeFailureOf,
} from '@/features/news/news-failure';
import { FeedFetchError } from '@/features/news/news-transport';
import type { FeedFailure } from '@/features/news/news-types';

const ALL_FEED_KINDS: readonly FeedFailure['kind'][] = [
  'offline',
  'cors',
  'network',
  'timeout',
  'http',
  'too-large',
  'not-a-feed',
  'malformed',
  'rejected',
  'empty',
  'unexpected',
];

afterEach(() => vi.restoreAllMocks());

describe('feed failure states', () => {
  it('gives every kind its own title, and no generic one', () => {
    const titles = ALL_FEED_KINDS.map((kind) => FEED_FAILURE_STATES[kind].title);
    expect(new Set(titles).size).toBe(ALL_FEED_KINDS.length);
    for (const title of titles) expect(title).not.toMatch(/что-то пошло не так/iu);
  });

  it('covers exactly the kinds of the failure type and the subscribe refusals', () => {
    expect(Object.keys(FEED_FAILURE_STATES).sort()).toEqual([...ALL_FEED_KINDS].sort());
    expect(Object.keys(SUBSCRIBE_FAILURE_STATES).sort()).toEqual(
      [...ALL_FEED_KINDS, 'invalid-input', 'limit'].sort(),
    );
  });

  it('only uses actions that have a label', () => {
    for (const state of Object.values(SUBSCRIBE_FAILURE_STATES)) {
      if (state.action) expect(ERROR_ACTION_LABELS[state.action]).toBeTruthy();
    }
  });

  it('adds the status to an http failure and the reason to invalid input', () => {
    expect(failureState({ kind: 'http', status: 503 }).title).toBe('Источник вернул ошибку 503');
    expect(failureState({ kind: 'http' }).title).toBe('Источник вернул ошибку');
    expect(failureState({ kind: 'invalid-input', reason: 'Введите запрос.' }).text).toBe(
      'Введите запрос.',
    );
  });

  it('says the same about «refused» and «unreachable» in the browser build', () => {
    const refused = failureState({ kind: 'cors' }, { browserBuild: true });
    expect(failureState({ kind: 'network' }, { browserBuild: true })).toEqual(refused);
    expect(refused.text).toBe('Ленты загружаются в приложении для Android.');
    expect(refused.action).toBeUndefined();
    expect(failureState({ kind: 'network' }).title).toBe(FEED_FAILURE_STATES.network.title);
    expect(failureState({ kind: 'timeout' }, { browserBuild: true }).title).toBe(
      FEED_FAILURE_STATES.timeout.title,
    );
  });

  it('joins title and text for a toast', () => {
    expect(failureLine({ title: 'Нет сети', text: 'Показаны сохранённые записи.' })).toBe(
      'Нет сети. Показаны сохранённые записи.',
    );
    expect(failureLine({ title: 'Лимит' })).toBe('Лимит');
  });

  it('wires an action only when the screen can perform it', () => {
    const retry = vi.fn();
    expect(failureProps({ kind: 'timeout' }, { retry })).toMatchObject({
      actionLabel: 'Повторить',
      onAction: retry,
    });
    expect(failureProps({ kind: 'timeout' }, {})).not.toHaveProperty('onAction');
  });
});

describe('failure mapping', () => {
  it('maps every transport and parser code to the kind of the same name', () => {
    for (const kind of ALL_FEED_KINDS.filter((k) => k !== 'unexpected' && k !== 'http')) {
      expect(feedFailureOf(new FeedFetchError(kind, 'x'))).toEqual({ kind });
    }
    for (const code of ['empty', 'too-large', 'not-a-feed', 'malformed', 'rejected'] as const) {
      expect(feedFailureOf(new FeedParseError(code, 'x'))).toEqual({ kind: code });
    }
  });

  it('keeps the http status', () => {
    expect(feedFailureOf(new FeedFetchError('http', 'x', 404))).toEqual({
      kind: 'http',
      status: 404,
    });
    expect(failureFromCode('http', 500)).toEqual({ kind: 'http', status: 500 });
  });

  it('turns an unknown error into `unexpected` and logs it instead of dropping it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cause = new TypeError('boom');
    expect(feedFailureOf(cause)).toEqual({ kind: 'unexpected' });
    expect(warn).toHaveBeenCalledWith(expect.any(String), cause);
  });

  it('maps the app refusals', () => {
    expect(subscribeFailureOf(new SubscribeRefusal({ kind: 'limit' }))).toEqual({ kind: 'limit' });
    expect(new SubscribeRefusal({ kind: 'limit' }).message).toMatch(/предел/u);
  });

  it('returns outcomes as values', async () => {
    await expect(attemptFeed(async () => 7)).resolves.toEqual({ ok: true, value: 7 });
    await expect(
      attemptFeed(async () => {
        throw new FeedFetchError('timeout', 'x');
      }),
    ).resolves.toEqual({ ok: false, error: { kind: 'timeout' } });
    await expect(
      attemptSubscribe(async () => {
        throw new SubscribeRefusal({ kind: 'invalid-input', reason: 'Пусто.' });
      }),
    ).resolves.toEqual({ ok: false, error: { kind: 'invalid-input', reason: 'Пусто.' } });
  });
});
