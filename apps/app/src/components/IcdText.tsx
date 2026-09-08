import { For, type JSX } from 'solid-js';

import { splitIcdCodes } from './splitIcdCodes';

export function IcdText(props: { readonly text: string }): JSX.Element {
  return (
    <For each={splitIcdCodes(props.text)}>
      {(part) => (part.code ? <span class="icd-code">{part.text}</span> : part.text)}
    </For>
  );
}
