import { type Accessor, createResource, type ResourceFetcher, type ResourceSource } from 'solid-js';

/**
 * Async data that never takes part in Suspense.
 *
 * The app wraps every tab in one Suspense boundary whose fallback is a page-level spinner. A plain
 * `createResource` read puts the whole boundary back to that spinner whenever the resource loads
 * (first time) or refetches (its source changed: a core swap, an install), so a card inside a
 * result list blanked the entire search page for the length of its load. A quiet resource starts
 * out «resolved» (`initialValue`) and is read through `.latest`, so it only ever updates in place:
 * `value()` keeps the last loaded value while a refetch runs and is undefined before the first one.
 *
 * Use it for anything inside a screen that stays on display (cards, previews, counters); keep
 * `createResource` for a view that is meant to wait behind the boundary.
 */
export interface QuietResource<T> {
  readonly value: Accessor<T | undefined>;
  /** A load is running (the first, or a refetch behind the value on screen). */
  readonly loading: Accessor<boolean>;
  readonly error: Accessor<unknown>;
}

export function createQuietResource<T, S>(
  source: ResourceSource<S>,
  fetcher: ResourceFetcher<S, T | undefined>,
): QuietResource<T>;
export function createQuietResource<T>(
  fetcher: ResourceFetcher<true, T | undefined>,
): QuietResource<T>;
export function createQuietResource<T, S>(
  sourceOrFetcher: ResourceSource<S> | ResourceFetcher<true, T | undefined>,
  maybeFetcher?: ResourceFetcher<S, T | undefined>,
): QuietResource<T> {
  const [resource] = maybeFetcher
    ? createResource<T | undefined, S>(sourceOrFetcher as ResourceSource<S>, maybeFetcher, {
        initialValue: undefined,
      })
    : createResource<T | undefined, true>(sourceOrFetcher as ResourceFetcher<true, T | undefined>, {
        initialValue: undefined,
      });
  return {
    value: () => resource.latest,
    loading: () => resource.loading,
    error: () => resource.error,
  };
}
