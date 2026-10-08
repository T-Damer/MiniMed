import type { JSX } from 'solid-js';

import './conversation-recorder.css';

/** Three quiet dots: the model is listening (steady) or reading a stretch (brighter). */
export function PulseDots(props: {
  readonly working?: boolean;
  readonly label: string;
}): JSX.Element {
  return (
    <span
      class="conversation-pulse"
      classList={{ 'conversation-pulse--working': props.working === true }}
      role="status"
      aria-label={props.label}
    >
      <span class="conversation-pulse__dot" />
      <span class="conversation-pulse__dot" />
      <span class="conversation-pulse__dot" />
    </span>
  );
}
