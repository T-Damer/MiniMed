import { type Accessor, createEffect, createSignal, on, onCleanup } from 'solid-js';

export interface Debouncer<Args extends readonly unknown[]> {
  /** Runs the action after `delayMs` without another call; a new call restarts the wait. */
  readonly call: (...args: Args) => void;
  /** Drops the waiting call, if any. */
  readonly cancel: () => void;
}

/** Framework-free debounce: input-driven work (previews, filters, autosave) goes through it. */
export function createDebouncer<Args extends readonly unknown[]>(
  action: (...args: Args) => void,
  delayMs: number,
): Debouncer<Args> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    call: (...args) => {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        action(...args);
      }, delayMs);
    },
    cancel,
  };
}

/** Follows `source` once it has stopped changing for `delayMs`. */
export function createDebouncedValue<T>(source: Accessor<T>, delayMs: number): Accessor<T> {
  const [settled, setSettled] = createSignal<T>(source());
  const debouncer = createDebouncer((value: T) => setSettled(() => value), delayMs);
  createEffect(on(source, (value) => debouncer.call(value), { defer: true }));
  onCleanup(debouncer.cancel);
  return settled;
}
