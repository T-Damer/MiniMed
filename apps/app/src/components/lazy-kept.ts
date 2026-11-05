import { type Component, type JSX, lazy } from 'solid-js';

/**
 * `lazy` for a screen that mounts and unmounts as the route changes. Solid's own wrapper makes a
 * resource on every mount, so each return to the screen suspends for a tick and its `Suspense`
 * boundary draws (and removes) its fallback skeleton again. Once the chunk is in, this one renders
 * the component on the spot.
 */
export function lazyKept<T extends Component<never>>(
  load: () => Promise<{ readonly default: T }>,
): T {
  type Props = Parameters<T>[0];
  let loaded: ((props: Props) => JSX.Element) | undefined;
  const first = lazy(() =>
    load().then((module) => {
      loaded = module.default as unknown as (props: Props) => JSX.Element;
      return { default: module.default as unknown as Component<Props> };
    }),
  );
  return ((props: Props): JSX.Element => (loaded ? loaded(props) : first(props))) as unknown as T;
}
