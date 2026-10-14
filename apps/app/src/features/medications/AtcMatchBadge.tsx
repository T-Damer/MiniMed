import type { SearchAtcMatch } from '@localmed/contracts';
import { type JSX, Show } from 'solid-js';

import { atcMatchLabel } from '@/features/medications/atc-match-label';
import '@/features/medications/atc-match-badge.css';

/**
 * The ATC code a drug was found under (ATC5), in a result card and in the suggestions of a drug
 * picker: «J05AX13», with «в реестре: L03AX» beside a code the registry holds only as a stub.
 */
export function AtcMatchBadge(props: {
  readonly match: SearchAtcMatch;
  /** The place's own class (spacing); the badge brings none. */
  readonly class?: string;
}): JSX.Element {
  const label = () => atcMatchLabel(props.match);
  return (
    <span class={`atc-match-badge ${props.class ?? ''}`.trim()} data-testid="atc-match">
      <span class="atc-match-badge__code">{label().code}</span>
      <Show when={label().registryNote}>
        {(note) => <span class="atc-match-badge__note">{note()}</span>}
      </Show>
    </span>
  );
}
