import { For, type JSX } from 'solid-js';

import { softBreakParts } from '@/components/soft-break';

/**
 * Plain text in which a line may break after «+», «/» and «-» (active substances of a combined
 * drug: «ПАРАЦЕТАМОЛ+ФЕНИЛЭФРИН+ФЕНИРАМИН»). Without these opportunities a long name is one
 * unbreakable word and the browser breaks it in the middle of a word to fit the line. The text
 * itself is unchanged (`<wbr>` adds no character), so offsets, copying and find stay exact.
 */
export function SoftBreakText(props: { readonly text: string }): JSX.Element {
  return (
    <For each={softBreakParts(props.text)}>
      {(part, index) => (
        <>
          {index() > 0 ? <wbr /> : null}
          {part}
        </>
      )}
    </For>
  );
}
