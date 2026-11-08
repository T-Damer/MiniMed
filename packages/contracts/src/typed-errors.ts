import type { Result } from './result';

/**
 * Typed, exhaustively handled errors (docs/ERRORS.md). An error is a value with a `kind`
 * discriminant; every place that reacts to one must cover every kind, and every kind must have a
 * user-facing state. Pure TypeScript: usable by core and by the app alike.
 */
export interface KindedError {
  readonly kind: string;
}

/** The existing `Result` narrowed to errors that carry a `kind`. */
export type TypedResult<TValue, TError extends KindedError> = Result<TValue, TError>;

/** Compile-time proof that a branch is unreachable; throws if it is reached anyway. */
export function assertNever(value: never, context = 'value'): never {
  throw new Error(`Unhandled ${context}: ${JSON.stringify(value)}`);
}

/** One handler per error kind: a missing kind is a compile error. */
export type ErrorHandlers<TError extends KindedError, TResult> = {
  readonly [K in TError['kind']]: (error: Extract<TError, { readonly kind: K }>) => TResult;
};

export function matchError<TError extends KindedError, TResult>(
  error: TError,
  handlers: ErrorHandlers<TError, TResult>,
): TResult {
  const handler = handlers[error.kind as TError['kind']] as
    | ((error: TError) => TResult)
    | undefined;
  if (!handler) return assertNever(error as never, 'error kind');
  return handler(error);
}

/** What the person can do about an error; the screen decides how to label and wire each. */
export type ErrorAction = 'retry' | 'download' | 'settings' | 'open-external' | 'dismiss';

/** The user-facing state of one error kind: plain fact, one line on what happens next, one action. */
export interface ErrorState {
  readonly title: string;
  readonly text?: string;
  readonly action?: ErrorAction;
}

/** Every error kind has its own state; a kind without one does not compile. */
export type ErrorStates<TError extends KindedError> = {
  readonly [K in TError['kind']]: ErrorState;
};

export function errorStateOf<TError extends KindedError>(
  states: ErrorStates<TError>,
  error: TError,
): ErrorState {
  return states[error.kind as TError['kind']];
}

/** Button label of each action; a `Record` over the union, so a new action needs a label. */
export const ERROR_ACTION_LABELS: Readonly<Record<ErrorAction, string>> = {
  retry: 'Повторить',
  download: 'Скачать',
  settings: 'Настройки',
  'open-external': 'Открыть как сайт',
  dismiss: 'Понятно',
};
