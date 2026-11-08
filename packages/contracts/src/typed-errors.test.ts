import { describe, expect, it } from 'vitest';

import { err, ok } from './result';
import {
  assertNever,
  type ErrorStates,
  errorStateOf,
  type KindedError,
  matchError,
  type TypedResult,
} from './typed-errors';

type Sample =
  | { readonly kind: 'offline' }
  | { readonly kind: 'http'; readonly status: number }
  | { readonly kind: 'empty' };

describe('matchError', () => {
  it('routes each kind to its handler with the narrowed error', () => {
    const label = (error: Sample): string =>
      matchError(error, {
        offline: () => 'offline',
        http: (e) => `http ${e.status}`,
        empty: () => 'empty',
      });
    expect(label({ kind: 'offline' })).toBe('offline');
    expect(label({ kind: 'http', status: 503 })).toBe('http 503');
    expect(label({ kind: 'empty' })).toBe('empty');
  });

  it('refuses a handler table that misses a kind (compile-time)', () => {
    const run = (error: Sample): number =>
      // @ts-expect-error `empty` is not handled
      matchError(error, { offline: () => 1, http: () => 2 });
    const runOne = (error: Sample): number =>
      // @ts-expect-error `http` and `empty` are not handled
      matchError(error, { offline: () => 1 });
    expect(run({ kind: 'offline' })).toBe(1);
    expect(runOne({ kind: 'offline' })).toBe(1);
  });

  it('refuses a handler for a kind that does not exist (compile-time)', () => {
    const run = (error: Sample): number =>
      matchError(error, {
        offline: () => 1,
        http: () => 2,
        empty: () => 3,
        // @ts-expect-error `unknown-kind` is not an error kind
        'unknown-kind': () => 4,
      });
    expect(run({ kind: 'empty' })).toBe(3);
  });

  it('throws on a kind that slipped past the types', () => {
    expect(() =>
      matchError({ kind: 'surprise' } as unknown as Sample, {
        offline: () => 1,
        http: () => 2,
        empty: () => 3,
      }),
    ).toThrow(/error kind/u);
  });
});

describe('ErrorStates', () => {
  const states: ErrorStates<Sample> = {
    offline: { title: 'Нет сети', action: 'retry' },
    http: { title: 'Источник вернул ошибку' },
    empty: { title: 'Пусто', text: 'Ответ без записей.' },
  };

  it('has a state for every kind and returns it', () => {
    expect(errorStateOf(states, { kind: 'offline' }).action).toBe('retry');
    expect(errorStateOf(states, { kind: 'empty' }).text).toBe('Ответ без записей.');
  });

  it('refuses a table that misses a kind (compile-time)', () => {
    // @ts-expect-error `empty` has no state
    const missing: ErrorStates<Sample> = { offline: { title: 'a' }, http: { title: 'b' } };
    expect(Object.keys(missing)).toHaveLength(2);
  });
});

describe('assertNever and TypedResult', () => {
  it('assertNever throws with the context', () => {
    expect(() => assertNever('x' as never, 'mode')).toThrow(/Unhandled mode/u);
  });

  it('switch with assertNever is exhaustive', () => {
    const name = (error: Sample): string => {
      switch (error.kind) {
        case 'offline':
          return 'a';
        case 'http':
          return 'b';
        case 'empty':
          return 'c';
        default:
          return assertNever(error);
      }
    };
    expect(name({ kind: 'empty' })).toBe('c');
  });

  it('carries a kinded error through the shared Result helpers', () => {
    const parse = (text: string): TypedResult<number, KindedError & Sample> =>
      text ? ok(text.length) : err({ kind: 'empty' });
    expect(parse('ab')).toEqual({ ok: true, value: 2 });
    expect(parse('')).toEqual({ ok: false, error: { kind: 'empty' } });
  });
});
