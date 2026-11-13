import { For, type JSX } from 'solid-js';

import './conversation-recorder.css';

/** Three quiet dots: the model is listening (still) or reading a stretch (moving, accent). */
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
      <For each={[0, 1, 2]}>
        {(index) => (
          <span
            class={`conversation-pulse__dot conversation-pulse__dot--${index + 1}`}
            classList={{ 'conversation-pulse__dot--working': props.working === true }}
          />
        )}
      </For>
    </span>
  );
}
