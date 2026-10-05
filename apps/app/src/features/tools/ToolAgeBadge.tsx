import type { ToolAgeScope } from '@localmed/contracts';
import type { JSX } from 'solid-js';
import { toolAgeBadge } from '@/features/tools/tool-age-scope';

import '@/features/tools/tool-age.css';

/** Who the tool is for, in a few words; the full statement it rests on is the tooltip. */
export function ToolAgeBadge(props: { readonly scope: ToolAgeScope }): JSX.Element {
  const badge = () => toolAgeBadge(props.scope);
  return (
    <span
      class={`tool-age-badge tool-age-badge--${badge().tone}`}
      title={props.scope.basis}
      data-age-tone={badge().tone}
    >
      {badge().label}
    </span>
  );
}
