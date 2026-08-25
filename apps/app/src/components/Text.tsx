import type { JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';

export type HeadingDepth = 1 | 2 | 3;

/**
 * Route-depth-aware page heading: depth 1 = section root, 2 = subpage,
 * 3 = tool/detail page. Not for document readers or modal dialogs —
 * those keep their own typography.
 */
export function Heading(props: {
  readonly depth?: HeadingDepth;
  readonly class?: string;
  readonly children: JSX.Element;
}): JSX.Element {
  const depth = () => props.depth ?? 1;
  return (
    <Dynamic
      component={`h${depth()}` as 'h1' | 'h2' | 'h3'}
      class={`app-heading app-heading--depth-${depth()}${props.class ? ` ${props.class}` : ''}`}
    >
      {props.children}
    </Dynamic>
  );
}
