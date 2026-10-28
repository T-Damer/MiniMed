import type { JSX } from 'solid-js';

/** «в сети»: the patient's phone talks to the service right now (green dot and word). */
export function OnlineTag(): JSX.Element {
  return (
    <span class="diary-online-tag">
      <span class="diary-online-tag__dot" aria-hidden="true" />в сети
    </span>
  );
}
