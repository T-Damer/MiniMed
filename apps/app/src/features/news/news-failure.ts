import {
  type ErrorState,
  type ErrorStates,
  err,
  errorStateOf,
  ok,
  type TypedResult,
} from '@localmed/contracts';

import {
  type CalmErrorProps,
  calmErrorProps,
  type ErrorActionHandlers,
} from '@/components/calm-error-props';
import { FeedParseError } from '@/features/news/feed-parser';
import {
  BROWSER_FEEDS_MESSAGE,
  FeedFetchError,
  feedsNeedNativeApp,
} from '@/features/news/news-transport';
import type { FeedFailure, FetchFailureCode, SubscriptionError } from '@/features/news/news-types';

/**
 * Every way a source can fail and what the person sees for it (docs/ERRORS.md). The table is typed
 * `ErrorStates<…>`: a new kind without a state of its own does not compile. Plain facts, one line on
 * what happens next, no generic «что-то пошло не так».
 */
export const FEED_FAILURE_STATES: ErrorStates<FeedFailure> = {
  offline: { title: 'Нет сети', text: 'Показаны сохранённые записи.', action: 'retry' },
  cors: {
    title: 'Источник закрыт для браузера',
    text: 'Он не разрешает чтение из браузера: откройте его в приложении для Android или как сайт.',
    action: 'open-external',
  },
  network: {
    title: 'Не удалось связаться с источником',
    text: 'Проверьте адрес и соединение.',
    action: 'retry',
  },
  timeout: { title: 'Источник не ответил вовремя', text: 'Повторите позже.', action: 'retry' },
  http: { title: 'Источник вернул ошибку', text: 'Повторите позже.', action: 'retry' },
  'too-large': {
    title: 'Ответ источника слишком большой',
    text: 'Его можно открыть как сайт.',
    action: 'open-external',
  },
  'not-a-feed': {
    title: 'По этому адресу нет ленты',
    text: 'Проверьте адрес или добавьте его как сайт.',
    action: 'open-external',
  },
  malformed: {
    title: 'Лента повреждена',
    text: 'Её не удалось прочитать; сохранённые записи не тронуты.',
    action: 'retry',
  },
  rejected: {
    title: 'Источник не принял запрос',
    text: 'Измените запрос или повторите позже.',
    action: 'retry',
  },
  empty: { title: 'Источник вернул пустой ответ', text: 'Повторите позже.', action: 'retry' },
  unexpected: {
    title: 'Ответ источника не удалось обработать',
    text: 'Сохранённые записи не тронуты.',
    action: 'retry',
  },
};

/** What can stop a new subscription: a source failure, or the app's own refusal. */
export type SubscribeFailure =
  | FeedFailure
  | { readonly kind: 'limit' }
  | { readonly kind: 'invalid-input'; readonly reason: string };

export const SUBSCRIBE_FAILURE_STATES: ErrorStates<SubscribeFailure> = {
  ...FEED_FAILURE_STATES,
  limit: { title: 'Достигнут предел числа источников', text: 'Удалите ненужные.' },
  'invalid-input': { title: 'Этот ввод не подходит', action: 'dismiss' },
};

/** A refusal made by the app itself before any request (not a source failure). */
export class SubscribeRefusal extends Error {
  readonly failure: Extract<SubscribeFailure, { kind: 'limit' | 'invalid-input' }>;

  constructor(failure: SubscribeRefusal['failure']) {
    super(failure.kind === 'limit' ? 'Достигнут предел числа источников.' : failure.reason);
    this.name = 'SubscribeRefusal';
    this.failure = failure;
  }
}

export type FeedResult<T> = TypedResult<T, FeedFailure>;
export type SubscribeResult<T> = TypedResult<T, SubscribeFailure>;

/**
 * The one place a thrown transport/parser error becomes a typed value. Anything that is not a known
 * failure is `unexpected` and is logged, never dropped.
 */
export function feedFailureOf(error: unknown): FeedFailure {
  if (error instanceof FeedFetchError) return failureFromCode(error.code, error.status);
  if (error instanceof FeedParseError) return { kind: error.code };
  console.warn('Неожиданная ошибка источника.', error);
  return { kind: 'unexpected' };
}

export function subscribeFailureOf(error: unknown): SubscribeFailure {
  return error instanceof SubscribeRefusal ? error.failure : feedFailureOf(error);
}

export function failureFromCode(code: FetchFailureCode, status?: number): FeedFailure {
  return code === 'http' ? { kind: 'http', status } : { kind: code };
}

/** Runs a fallible source operation and returns its outcome as a value. */
export async function attemptFeed<T>(run: () => Promise<T>): Promise<FeedResult<T>> {
  try {
    return ok(await run());
  } catch (error) {
    return err(feedFailureOf(error));
  }
}

export async function attemptSubscribe<T>(run: () => Promise<T>): Promise<SubscribeResult<T>> {
  try {
    return ok(await run());
  } catch (error) {
    return err(subscribeFailureOf(error));
  }
}

/**
 * The state to show. A browser build cannot tell «refused» from «unreachable» and can do nothing
 * about either, so both say the same thing there and offer no action.
 */
export function failureState(
  failure: SubscribeFailure,
  options: { readonly browserBuild?: boolean } = {},
): ErrorState {
  if (options.browserBuild && (failure.kind === 'cors' || failure.kind === 'network')) {
    return { title: FEED_FAILURE_STATES.cors.title, text: BROWSER_FEEDS_MESSAGE };
  }
  const effective = failure;
  const state = errorStateOf(SUBSCRIBE_FAILURE_STATES, effective);
  if (effective.kind === 'http' && effective.status) {
    return { ...state, title: `${state.title} ${effective.status}` };
  }
  if (effective.kind === 'invalid-input') return { ...state, text: effective.reason };
  return state;
}

/** One line for a toast or a list row: the fact, then what happens next. */
export function failureLine(state: ErrorState): string {
  return state.text ? `${state.title}. ${state.text}` : state.title;
}

/** The stored error of a subscription, with the text to show derived from its kind. */
export function subscriptionFailure(error: SubscriptionError): FeedFailure {
  return failureFromCode(error.code, error.status);
}

/** The toast for a thrown error of a subscribe action. */
export function failureToast(error: unknown): string {
  return failureLine(
    failureState(subscribeFailureOf(error), { browserBuild: feedsNeedNativeApp() }),
  );
}

/** Props for the calm error component for a source failure on a screen that can do `handlers`. */
export function failureProps(
  failure: SubscribeFailure,
  handlers: ErrorActionHandlers,
): CalmErrorProps {
  return calmErrorProps(failureState(failure, { browserBuild: feedsNeedNativeApp() }), handlers);
}

/** The state of the failure kept on a subscription after its last refresh. */
export function subscriptionErrorState(error: SubscriptionError): ErrorState {
  return failureState(subscriptionFailure(error));
}
